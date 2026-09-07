// Server Backend Utama MERMUD Mobile
// Menyediakan REST API & WebSocket Realtime Bidding Engine (ala inDrive)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// In-Memory Database State (Representasi Model Relasional)
const db = {
  users: [
    {
      id: 'usr-01',
      name: 'Daniel Prasetyo',
      phone: '081234567890',
      city: 'Manado',
      role: 'HOST',
      walletBalance: 350000,
      escrowLocked: 0,
      isKycVerified: true
    },
    {
      id: 'cmp-01',
      name: 'Grace Wuwungan',
      phone: '081298765432',
      city: 'Manado',
      role: 'COMPANION',
      tier: 'Gold',
      rating: 4.9,
      hobbies: ['Ngopi', 'Kuliner', 'Diskusi Startup'],
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      isKycVerified: true
    },
    {
      id: 'cmp-02',
      name: 'Michael Sompie',
      phone: '081311223344',
      city: 'Tomohon',
      role: 'COMPANION',
      tier: 'Platinum',
      rating: 5.0,
      hobbies: ['Fotografi', 'Wisata Alam', 'Badminton'],
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      isKycVerified: true
    }
  ],
  whitelistedVenues: [
    { id: 'v-1', name: 'Kawasan Megamas Manado (Coffee Bean / Resto)', city: 'Manado', type: 'Cafe/Lounge' },
    { id: 'v-2', name: 'Manado Town Square (Mantos 3 Area Lobby)', city: 'Manado', type: 'Mall/Cafe' },
    { id: 'v-3', name: 'Puncak Rurukan Cafe, Tomohon', city: 'Tomohon', type: 'Scenic Cafe' },
    { id: 'v-4', name: 'Danau Linow Resort Cafe, Tomohon', city: 'Tomohon', type: 'Scenic Cafe' },
    { id: 'v-5', name: 'Tepi Danau Tondano (Restoran Apung)', city: 'Tondano', type: 'Restaurant' },
    { id: 'v-6', name: 'Pusat Kuliner Ikan Bakar Bitung', city: 'Bitung', type: 'Culinary Area' },
    { id: 'v-7', name: 'Warkop Kopi Kotamobagu', city: 'Kotamobagu', type: 'Traditional Cafe' }
  ],
  hangoutRequests: [],
  bids: [],
  chatMessages: []
};

// AI SafeVibe Content Filter Helper
function scanTextWithSafeVibe(text) {
  if (!text) return { isSafe: true };
  const lower = text.toLowerCase();
  const bannedWords = ['hotel', 'motel', 'penginapan', 'kamar', 'open bo', 'bo', 'st', 'lt', 'eksekusi', 'kost', 'apartemen pribadi', 'plus-plus'];
  
  for (const word of bannedWords) {
    if (lower.includes(word)) {
      return {
        isSafe: false,
        reason: `Pesan mengandung kata terlarang / indikasi tempat privat ('${word}'). MERMUD hanya mengizinkan pertemuan di tempat publik resmi.`
      };
    }
  }
  return { isSafe: true };
}

// ================= API ENDPOINTS ================= //

// 1. Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    app: 'MERMUD Mobile Engine',
    version: '1.0.0',
    currency: 'IDR (Rupiah)',
    supportedCities: ['Manado', 'Bitung', 'Tomohon', 'Tondano', 'Kotamobagu'],
    activeRequestsCount: db.hangoutRequests.length
  });
});

// 2. Ambil Daftar Tempat Publik Resmi (Whitelisted)
app.get('/api/venues', (req, res) => {
  const { city } = req.query;
  if (city) {
    const filtered = db.whitelistedVenues.filter(v => v.city.toLowerCase() === city.toLowerCase());
    return res.json({ success: true, data: filtered });
  }
  res.json({ success: true, data: db.whitelistedVenues });
});

// 3. Buat Permintaan Kencan / Hangout (Host) + Kunci Saldo Escrow
app.post('/api/hangouts/create', (req, res) => {
  const { hostId, category, venueId, scheduledTime, durationMinutes, initialBudgetRupiah, notes } = req.body;

  // AI Content Scan
  const aiCheck = scanTextWithSafeVibe(notes);
  if (!aiCheck.isSafe) {
    return res.status(400).json({ success: false, error: aiCheck.reason });
  }

  const host = db.users.find(u => u.id === (hostId || 'usr-01'));
  if (!host) {
    return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
  }

  const budget = parseInt(initialBudgetRupiah, 10);
  if (host.walletBalance < budget) {
    return res.status(400).json({
      success: false,
      error: `Saldo Dompet Rupiah tidak mencukupi. Butuh Rp ${budget.toLocaleString('id-ID')}, saldo Anda: Rp ${host.walletBalance.toLocaleString('id-ID')}. Silakan top-up QRIS.`
    });
  }

  const venue = db.whitelistedVenues.find(v => v.id === venueId) || db.whitelistedVenues[0];

  // Kunci saldo di Escrow
  host.walletBalance -= budget;
  host.escrowLocked += budget;

  const newRequest = {
    id: `req-${Date.now()}`,
    hostId: host.id,
    hostName: host.name,
    category: category || 'Dating & Coffee Talk',
    venue: venue.name,
    city: venue.city,
    scheduledTime: scheduledTime || 'Hari ini, 19:30 WITA',
    durationMinutes: durationMinutes || 120,
    initialBudgetRupiah: budget,
    notes: notes || 'Ngobrol santai & berdiskusi.',
    status: 'OPEN_FOR_BIDS',
    createdAt: new Date().toISOString()
  };

  db.hangoutRequests.unshift(newRequest);

  // Broadcast realtime ke seluruh mitra via WebSocket
  io.emit('new_hangout_broadcast', newRequest);

  res.status(201).json({
    success: true,
    message: 'Ajakan berhasil dibuat. Saldo dikunci aman di Escrow MERMUD.',
    data: newRequest,
    wallet: {
      availableRupiah: host.walletBalance,
      escrowLockedRupiah: host.escrowLocked
    }
  });
});

// 4. Mitra Mengajukan Tawaran (Accept / Counter-Offer ala inDrive)
app.post('/api/hangouts/:requestId/bid', (req, res) => {
  const { requestId } = req.params;
  const { companionId, bidPriceRupiah, coverNote, estimatedArrivalMinutes } = req.body;

  const request = db.hangoutRequests.find(r => r.id === requestId);
  if (!request) {
    return res.status(404).json({ success: false, error: 'Permintaan hangout tidak ditemukan' });
  }

  const companion = db.users.find(u => u.id === (companionId || 'cmp-01'));
  const price = parseInt(bidPriceRupiah, 10);

  const newBid = {
    id: `bid-${Date.now()}`,
    requestId,
    companionId: companion.id,
    companionName: companion.name,
    avatar: companion.avatar,
    rating: companion.rating,
    tier: companion.tier,
    bidPriceRupiah: price,
    coverNote: coverNote || 'Saya siap menemani ngopi santai di lokasi!',
    estimatedArrivalMinutes: estimatedArrivalMinutes || 15,
    isCounterOffer: price !== request.initialBudgetRupiah,
    createdAt: new Date().toISOString()
  };

  db.bids.push(newBid);

  // Kirim notifikasi realtime ke Host
  io.emit(`bid_received_${request.id}`, newBid);

  res.status(201).json({
    success: true,
    message: 'Tawaran harga berhasil diajukan ke Host!',
    data: newBid
  });
});

// 5. Host Memilih Tawaran Mitra (Lock Deal & Generate QR Handshake)
app.post('/api/hangouts/:requestId/select-bid', (req, res) => {
  const { requestId } = req.params;
  const { bidId, hostId } = req.body;

  const request = db.hangoutRequests.find(r => r.id === requestId);
  const bid = db.bids.find(b => b.id === bidId);
  const host = db.users.find(u => u.id === (hostId || 'usr-01'));

  if (!request || !bid) {
    return res.status(404).json({ success: false, error: 'Request atau Bid tidak valid' });
  }

  // Jika harga deal lebih tinggi (Counter-Bid), potong selisihnya
  if (bid.bidPriceRupiah > request.initialBudgetRupiah) {
    const selisih = bid.bidPriceRupiah - request.initialBudgetRupiah;
    if (host.walletBalance < selisih) {
      return res.status(400).json({
        success: false,
        error: `Saldo tidak mencukupi untuk menerima penawaran lebih tinggi ini. Butuh tambahan Rp ${selisih.toLocaleString('id-ID')}.`
      });
    }
    host.walletBalance -= selisih;
    host.escrowLocked += selisih;
  }

  request.status = 'DEAL_LOCKED';
  request.selectedBidId = bid.id;
  request.finalPriceRupiah = bid.bidPriceRupiah;
  request.qrHandshakeCode = `MERMUD-${Math.floor(1000 + Math.random() * 9000)}`;

  io.emit(`deal_confirmed_${request.id}`, {
    request,
    selectedBid: bid,
    qrCode: request.qrHandshakeCode
  });

  res.json({
    success: true,
    message: 'Kesepakatan dikunci! Silakan temui mitra di lokasi publik dan scan QR Handshake.',
    data: {
      finalPrice: request.finalPriceRupiah,
      qrHandshakeCode: request.qrHandshakeCode
    }
  });
});

// 6. Validasi Sesi Selesai & Pencairan Dana Escrow Rupiah
app.post('/api/hangouts/:requestId/complete', (req, res) => {
  const { requestId } = req.params;
  const request = db.hangoutRequests.find(r => r.id === requestId);

  if (!request || request.status !== 'DEAL_LOCKED') {
    return res.status(400).json({ success: false, error: 'Sesi belum dalam status deal terkunci' });
  }

  const host = db.users.find(u => u.id === request.hostId);
  const bid = db.bids.find(b => b.id === request.selectedBidId);
  const companion = db.users.find(u => u.id === bid.companionId);

  const totalDeal = request.finalPriceRupiah;
  const platformFee = totalDeal * 0.15; // 15% Take-rate
  const companionNet = totalDeal - platformFee;

  // Cairkan dari escrow Host
  host.escrowLocked -= totalDeal;
  // Tambahkan ke saldo Companion
  companion.walletBalance = (companion.walletBalance || 0) + companionNet;

  request.status = 'COMPLETED';

  res.json({
    success: true,
    message: 'Sesi kencan / hangout resmi selesai!',
    financialSummary: {
      totalDealRupiah: totalDeal,
      platformFeeRupiah: platformFee,
      companionNetReceived: companionNet,
      currency: 'IDR'
    }
  });
});

// ================= WEBSOCKET REALTIME CONNECTION ================= //
io.on('connection', (socket) => {
  console.log(`[Socket Connected] Client ID: ${socket.id}`);

  // In-App Chat dengan Realtime AI SafeVibe Filter
  socket.on('send_chat_message', (data) => {
    const { requestId, senderId, senderName, text } = data;
    const aiScan = scanTextWithSafeVibe(text);

    if (!aiScan.isSafe) {
      socket.emit('chat_blocked', {
        error: aiScan.reason,
        flaggedText: text
      });
      return;
    }

    const message = {
      id: `msg-${Date.now()}`,
      requestId,
      senderId,
      senderName,
      text,
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      isSafe: true
    };

    db.chatMessages.push(message);
    io.emit(`chat_message_${requestId}`, message);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] Client ID: ${socket.id}`);
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 MERMUD Mobile Backend Server is RUNNING!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket Gateway ready for Realtime Bidding`);
  console.log(`🛡️ AI SafeVibe Guardian Active 24/7`);
  console.log(`====================================================`);
});
