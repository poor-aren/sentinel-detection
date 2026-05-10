const express = require('express');
const multer = require('multer');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ===== KONFIGURASI =====
// API key diambil dari environment variable (di-set di Koyeb dashboard)
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || 'YOUR_API_KEY_HERE';
const ROBOFLOW_URL = `https://serverless.roboflow.com/human-surveillance-detection-kesab/7?api_key=${ROBOFLOW_API_KEY}`;
const PORT = process.env.PORT || 3000;
// =======================

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

let latestDetection = {
  timestamp: null,
  humanCount: 0,
  imageBase64: null,
  predictions: [],
  imageWidth: 640,
  imageHeight: 480
};

// =============================================
// ENDPOINT: ESP32 kirim gambar (POST /upload)
// =============================================
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada gambar' });

    console.log(`[${new Date().toLocaleTimeString()}] Gambar diterima (${req.file.size} bytes)`);

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const roboflowRes = await fetch(ROBOFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: base64Image
    });

    if (!roboflowRes.ok) {
      const err = await roboflowRes.text();
      return res.status(500).json({ error: 'Roboflow error', detail: err });
    }

    const result = await roboflowRes.json();
    const predictions = result.predictions || [];
    const humanCount = predictions.length;

    console.log(`Deteksi: ${humanCount} manusia`);

    latestDetection = {
      timestamp: new Date().toISOString(),
      humanCount,
      imageBase64: `data:${mimeType};base64,${base64Image}`,
      predictions,
      imageWidth: result.image?.width || 640,
      imageHeight: result.image?.height || 480
    };

    io.emit('detection', latestDetection);

    res.json({
      success: true,
      human_count: humanCount,
      message: `${humanCount} manusia terdeteksi`
    });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/latest', (req, res) => res.json(latestDetection));
app.get('/status', (req, res) => res.json({ status: 'online', time: new Date().toISOString() }));

// Koyeb health check
app.get('/health', (req, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
  console.log('Browser terhubung');
  if (latestDetection.timestamp) socket.emit('detection', latestDetection);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server berjalan di port ${PORT}`);
  console.log(`API Key: ${ROBOFLOW_API_KEY ? '✓ SET' : '✗ BELUM DI-SET'}\n`);
});
