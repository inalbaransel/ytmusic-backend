import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

app.use(cors());
app.use(express.json({ limit: '50kb' })); // İstek boyutunu maksimum 50kb ile sınırla

// --- HIZ SINIRLARI (RATE LIMITING) ---

// Giriş/Kayıt için sıkı limit (15 dakikada 20 istek)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Çok fazla giriş denemesi, lütfen bekleyin." }
});

// Veri gönderimi için limit (1 dakikada 120 istek = saniyede 2 istek)
const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: "Veri gönderme hız sınırı aşıldı." }
});

app.use('/api/auth/', authLimiter);

// --- AUTH ENDPOINTS ---

// Kayıt Ol
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword
            }
        });
        
        res.status(201).json({ message: "Kullanıcı oluşturuldu!", apiKey: user.apiKey });
    } catch (error) {
        res.status(400).json({ error: "E-posta zaten kullanımda olabilir." });
    }
});

// Giriş Yap
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Geçersiz bilgiler." });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ token, apiKey: user.apiKey });
});


// --- INGEST ENDPOINT (Eklentiden Gelen Veri) ---

app.post('/api/ingest', ingestLimiter, async (req, res) => {
    const { apiKey, data } = req.body;
    
    if (!apiKey) return res.status(400).json({ error: "API Key gerekli." });
    
    try {
        const user = await prisma.user.findUnique({ 
            where: { apiKey },
            include: { playback: true }
        });
        
        if (!user) return res.status(403).json({ error: "Geçersiz API Key." });
        
        // Veriyi güncelle veya oluştur (Karakter sınırlarıyla güvenliği sağla)
        const playbackData = {
            title: String(data.title || "").substring(0, 200),
            artist: String(data.artist || "").substring(0, 100),
            album: String(data.album || "").substring(0, 100),
            artwork: String(data.artwork || "").substring(0, 500),
            currentTime: String(data.currentTime || "0:00").substring(0, 15),
            totalTime: String(data.totalTime || "0:00").substring(0, 15),
            currentTimeSeconds: Number(data.currentTimeSeconds) || 0,
            totalTimeSeconds: Number(data.totalTimeSeconds) || 0,
            isPlaying: Boolean(data.isPlaying)
        };

        await prisma.playback.upsert({
            where: { userId: user.id },
            update: playbackData,
            create: {
                ...playbackData,
                userId: user.id
            }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Sunucu hatası." });
    }
});


// --- PUBLIC STATUS ENDPOINT (Kullanıcının Sitesi İçin) ---

app.get('/api/status/:apiKey', async (req, res) => {
    const { apiKey } = req.params;
    
    try {
        const user = await prisma.user.findUnique({
            where: { apiKey },
            include: { playback: true }
        });
        
        if (!user || !user.playback) {
            return res.status(404).json({ error: "Veri bulunamadı." });
        }
        
        res.json(user.playback);
    } catch (error) {
        res.status(500).json({ error: "Sunucu hatası." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 SaaS Backend ${PORT} portunda hazır!`);
});
