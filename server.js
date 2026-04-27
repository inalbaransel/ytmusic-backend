const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Bellekte (RAM) kullanıcı yayınlarını tutacağız
const liveSessions = {};

// LRCLIB'den şarkı sözü listesini (Satır Satır) çeken fonksiyon
async function fetchLyricsFromLRCLIB(song, artist) {
    try {
        // Sanatçı isminden sadece İLK (Ana) sanatçıyı al (feat, &, virgül, ve, \n vb. temizle)
        let primaryArtist = artist;
        const splitRegex = /[,&x\n]| feat\. | ft\. | featuring | ve /i;
        const parts = artist.split(splitRegex);
        if (parts.length > 0) {
            primaryArtist = parts[0].trim();
        }

        console.log(`[LRCLIB] Sözler Aranıyor: "${song}" - "${primaryArtist}" (Orijinal: ${artist})`);
        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(song)}&artist_name=${encodeURIComponent(primaryArtist)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data && data.length > 0) {
            const track = data[0]; // En iyi eşleşen ilk sonucu al
            // Varsa zaman damgalı sözleri al, yoksa düz metin al
            let lyricsText = track.syncedLyrics || track.plainLyrics;
            
            if (!lyricsText) return [];

            // Satırlara böl
            const lines = lyricsText.split('\n');
            const map = [];
            
            lines.forEach((line, index) => {
                // Zaman damgasını çıkar (Örn: [00:14.23])
                const timeMatch = line.match(/\[(\d{2}):(\d{2}(?:\.\d{2})?)\]/);
                let startTime = 0;
                if (timeMatch) {
                    const minutes = parseInt(timeMatch[1], 10);
                    const seconds = parseFloat(timeMatch[2]);
                    startTime = (minutes * 60) + seconds;
                }

                // Zaman damgalarını temizle, sadece düz metin kalsın
                const text = line.replace(/\[.*?\]/g, '').trim();
                if (text) {
                    map.push({ index: index, text: text, startTime: startTime });
                }
            });
            
            console.log(`[LRCLIB] ${map.length} satır bulundu!`);
            return map;
        }
        return [];
    } catch (err) {
        console.error("[LRCLIB] API Hatası:", err.message);
        return [];
    }
}

// 1. CANLI VERİ (LIVE SYNC) VE OTOMATİK HARİTA ÇIKARICI
app.post('/api/ingest/live', async (req, res) => {
    const { apiKey, data } = req.body;
    if (!apiKey) return res.status(400).json({ error: "API Key required" });

    if (!liveSessions[apiKey]) liveSessions[apiKey] = { fullMap: null, liveData: null };
    
    const session = liveSessions[apiKey];

    // EĞER ŞARKI DEĞİŞTİYSE -> Arka planda gidip LRCLIB'den bütün şarkıyı listele (SATIR SATIR)
    if (!session.fullMap || session.fullMap.song !== data.song) {
        // Asenkron olarak haritayı çekip session'a kaydediyoruz.
        // Frontend'e SSE ile otomatik olarak iletilecek.
        fetchLyricsFromLRCLIB(data.song, data.artist).then(lyricsArray => {
            session.fullMap = {
                song: data.song,
                artist: data.artist,
                lyrics: lyricsArray
            };
        });
    }

    // Canlı akan Satır bilgisini güncelle
    session.liveData = {
        song: data.song,
        artist: data.artist,
        currentTimeMs: data.currentTimeMs,
        activeLine: data.activeLine, 
        activeTranslation: data.activeTranslation, 
        readingFocus: data.readingFocus, // YENİ: Eklentiden gelen fokus verisini pasla
        isBreak: data.isBreak,
        lastUpdated: Date.now()
    };

    res.json({ success: true });
});


// 2. MÜŞTERİNİN (FRONTEND'İN) VERİ ÇEKMESİ (SSE)
app.get('/api/stream', (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).json({ error: "API Key required" });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    res.write(`data: ${JSON.stringify({ type: "SYSTEM", status: "connected" })}\n\n`);

    let lastSentMapSong = "";
    let lastSentLiveLine = "";

    const interval = setInterval(() => {
        const session = liveSessions[apiKey];
        if (!session) return;

        // A) Eğer yeni bir şarkının Söz Listesi geldiyse, müşteriye 1 kez FULL_MAP gönder
        if (session.fullMap && session.fullMap.song !== lastSentMapSong) {
            res.write(`data: ${JSON.stringify({ type: "FULL_MAP", data: session.fullMap })}\n\n`);
            lastSentMapSong = session.fullMap.song;
        }

        // B) Canlı okunan SATIRI gönder (Sadece değiştiğinde)
        if (session.liveData) {
            const liveString = JSON.stringify(session.liveData);
            if (liveString !== lastSentLiveLine) {
                res.write(`data: ${JSON.stringify({ type: "LIVE_SYNC", data: session.liveData })}\n\n`);
                lastSentLiveLine = liveString;
            }
        }
    }, 50);

    req.on('close', () => clearInterval(interval));
});

app.listen(3000, () => {
    console.log('🚀 SATIR-SATIR Live Lyrics API Sunucusu Başladı (LRCLIB Entegreli)');
    console.log('🔗 Live Endpoint: POST /api/ingest/live');
});
