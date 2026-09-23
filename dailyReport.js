require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// tone map, only these keys are allowed through
const TONES = {
  formal: 'bahasa Indonesia formal baku, struktur laporan profesional',
  santai: 'bahasa Indonesia santai tapi tetap sopan, kalimat mengalir',
  profesional: 'bahasa Indonesia profesional ringkas, padat berisi',
  singkat: 'bahasa Indonesia formal, kalimat sangat ringkas langsung ke inti'
};

// builds the indonesian system prompt, forces strict JSON with exactly 3 keys
function buildSystemPrompt(toneDesc) {
  return (
    'Anda adalah pembuat laporan harian magang untuk MagangHub. Dari kata kunci kegiatan hari ini, ' +
    'hasilkan laporan harian. Keluarkan HANYA JSON ketat dengan tepat 3 key berupa string: ' +
    '"uraian" (Uraian Aktivitas — narasi kegiatan hari ini), ' +
    '"pembelajaran" (Pembelajaran yang Diperoleh — pelajaran yang didapat), ' +
    '"kendala" (Kendala yang Dialami — kendala; jika tidak ada, tulis kalimat jujur singkat seperti "Tidak ada kendala berarti."). ' +
    'Gunakan gaya bahasa berikut: ' + toneDesc + '. ' +
    'Jika ada catatan regenerate, perlakukan sebagai instruksi tambahan untuk menulis ulang secara berbeda (lebih pendek/sudut berbeda) sambil mempertahankan bentuk JSON. ' +
    'Jangan pernah bungkus dengan markdown.'
  );
}

app.post('/chat', async (req, res) => {
  const { keywords, tone, regenerate } = req.body || {};

  if (typeof keywords !== 'string' || keywords.trim() === '') {
    return res.status(400).json({ error: 'keywords wajib berupa teks tidak kosong' });
  }

  // unknown or missing tone falls back to formal
  const toneDesc = TONES[tone] || TONES.formal;

  // fail early when the key is missing from env
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY belum diatur di server' });
  }

  // append the regenerate hint so the model rewrites from another angle
  let userText = keywords;
  if (typeof regenerate === 'string' && regenerate.trim() !== '') {
    userText += '\n\nCatatan tambahan: ' + regenerate;
  }

  try {
    // gemini native REST call, system prompt carries the tone and JSON rules
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(toneDesc) }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          // responseMimeType makes gemini reply with JSON only
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    // log upstream details to the console, the client only sees a generic error
    if (!resp.ok) {
      const body = await resp.text();
      console.error('Gemini API error:', resp.status, body);
      return res.status(500).json({ error: 'Gagal menghasilkan laporan, coba lagi' });
    }

    const data = await resp.json();
    // walk down to the first candidate text, guards cover missing shapes
    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (typeof text !== 'string') {
      console.error('Gemini response missing candidate text:', JSON.stringify(data));
      return res.status(500).json({ error: 'Gagal menghasilkan laporan, coba lagi' });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // malformed JSON from the model, log it and bail
      console.error('Gemini JSON parse failure:', e.message, text);
      return res.status(500).json({ error: 'Gagal menghasilkan laporan, coba lagi' });
    }

    // coerce missing keys to empty string so the contract always has 3 fields
    return res.status(200).json({
      uraian: typeof parsed.uraian === 'string' ? parsed.uraian : '',
      pembelajaran: typeof parsed.pembelajaran === 'string' ? parsed.pembelajaran : '',
      kendala: typeof parsed.kendala === 'string' ? parsed.kendala : ''
    });
  } catch (err) {
    // network or unexpected failure upstream
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Gagal menghasilkan laporan, coba lagi' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server listening on port ' + port);
});
