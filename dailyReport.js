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

// length map, only these keys are allowed through, missing or unknown means default
const LENGTHS = {
  shorter: 'tulis ringkas, langsung ke inti, tanpa basa basi',
  longer: 'tulis lebih rinci dan panjang, kembangkan setiap bagian dengan contoh konkret dari kata kunci'
};

// builds the indonesian system prompt, forces strict JSON with exactly 3 keys
function buildSystemPrompt(toneDesc, lengthDesc) {
  return (
    'Anda adalah pembuat laporan harian magang untuk MagangHub. Dari kata kunci kegiatan hari ini, ' +
    'hasilkan laporan harian. Jelaskan seluruh kata kunci secara lengkap. ' +
    'Setiap bagian keluaran ("uraian", "pembelajaran", "kendala") wajib berisi minimal 200 karakter konten nyata. ' +
    'Keluarkan HANYA JSON ketat dengan tepat 3 key berupa string: ' +
    '"uraian" (Uraian Aktivitas — narasi kegiatan hari ini), ' +
    '"pembelajaran" (Pembelajaran yang Diperoleh — pelajaran yang didapat), ' +
    '"kendala" (Kendala yang Dialami — kendala; jika tidak ada, tetap tulis paragraf jujur yang substansial minimal 200 karakter dengan mengelaborasi aspek proses, koordinasi, atau teknis yang dialami, tanpa mengarang masalah). ' +
    'Gunakan gaya bahasa berikut: ' + toneDesc + '. ' +
    (lengthDesc ? 'Panjang tulisan: ' + lengthDesc + '. ' : '') +
    'Jika ada catatan regenerate, perlakukan sebagai instruksi tambahan untuk menulis ulang secara berbeda (lebih pendek/sudut berbeda) sambil mempertahankan bentuk JSON. ' +
    'Jangan pernah bungkus dengan markdown.'
  );
}

// one gemini call, returns the parsed 3 key object, throws on any upstream problem
async function generate(userText, systemPrompt) {
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
        systemInstruction: { parts: [{ text: systemPrompt }] },
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
    throw new Error('gemini api error');
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
    throw new Error('missing candidate text');
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    // malformed JSON from the model, log it and bail
    console.error('Gemini JSON parse failure:', e.message, text);
    throw new Error('malformed json');
  }
}

// every section must reach MIN_SECTION characters of real content
const MIN_SECTION = 200;
const SECTIONS = ['uraian', 'pembelajaran', 'kendala'];
function shortSections(parsed) {
  return SECTIONS.filter((k) => typeof parsed[k] !== 'string' || parsed[k].length < MIN_SECTION);
}

app.post('/chat', async (req, res) => {
  const { keywords, tone, regenerate, length } = req.body || {};

  if (typeof keywords !== 'string' || keywords.trim() === '') {
    return res.status(400).json({ error: 'keywords wajib berupa teks tidak kosong' });
  }

  // unknown or missing tone falls back to formal
  const toneDesc = TONES[tone] || TONES.formal;
  // unknown or missing length falls back to default, no extra instruction
  const lengthDesc = LENGTHS[length] || '';

  // fail early when the key is missing from env
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY belum diatur di server' });
  }

  // append the regenerate hint so the model rewrites from another angle
  let userText = keywords;
  if (typeof regenerate === 'string' && regenerate.trim() !== '') {
    userText += '\n\nCatatan tambahan: ' + regenerate;
  }

  const systemPrompt = buildSystemPrompt(toneDesc, lengthDesc);

  try {
    let parsed = await generate(userText, systemPrompt);

    // ponytail: one retry then accept, more attempts only if quality demands it
    if (shortSections(parsed).length > 0) {
      try {
        parsed = await generate(
          userText +
            '\n\nCatatan: setiap bagian ("uraian", "pembelajaran", "kendala") wajib berisi minimal 200 karakter konten nyata, perluas bagian yang masih kurang dari 200 karakter.',
          systemPrompt
        );
      } catch (retryErr) {
        // keep the first result when the retry itself fails
        console.error('Length retry failed, returning first result:', retryErr.message);
      }
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
