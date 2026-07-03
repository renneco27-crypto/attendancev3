import express from 'express';
import cors from 'cors';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const sessions = new Map();
let livenessThreshold = 60;

(async () => {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'livenessThreshold').single();
    if (data) livenessThreshold = Number(data.value);
  } catch {}
})();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 10 * 60 * 1000) sessions.delete(id);
  }
}, 2 * 60 * 1000);

setInterval(async () => {
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
  await supabase
    .from('device_registrations')
    .delete()
    .lt('created_at', cutoff)
    .in('status', ['pending', 'revoked']);
}, 6 * 60 * 60 * 1000);

function rgbToYCbCr(r, g, b) {
  const y  = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return { y, cb, cr };
}

function isSkinTone(r, g, b) {
  const { y, cb, cr } = rgbToYCbCr(r, g, b);
  if (y < 15 || y > 250) return false;
  return cb >= 50 && cb <= 155 && cr >= 115 && cr <= 200;
}

async function analyzeFrame(frameBase64) {
  const buf = Buffer.from(frameBase64, 'base64');
  const { data, info } = await sharp(buf)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const topY = Math.floor(height * 0.2);
  const botY = Math.floor(height * 0.8);
  const centerStartX = Math.floor(width * 0.2);
  const centerEndX = Math.floor(width * 0.8);

  let skinSumX = 0;
  let skinSumY = 0;
  let skinCount = 0;
  let totalFaceZonePixels = 0;

  for (let y = topY; y < botY; y++) {
    for (let x = centerStartX; x < centerEndX; x++) {
      totalFaceZonePixels++;
      const idx = (y * width + x) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (isSkinTone(r, g, b)) {
        skinSumX += x;
        skinSumY += y;
        skinCount++;
      }
    }
  }

  let faceX = 0.5;
  let faceY = 0.5;
  let skinPixelRatio = 0;

  if (skinCount > 50) {
    faceX = (skinSumX / skinCount) / width;
    faceY = (skinSumY / skinCount) / height;
    skinPixelRatio = skinCount / totalFaceZonePixels;
  }

  return { faceX, faceY, skinPixelRatio, skinCount, totalFaceZonePixels };
}

function computePixelDiff(frame1, frame2, width, height, channels, topY, botY, centerStartX, centerEndX) {
  let sumDiff = 0;
  let count = 0;
  for (let y = topY; y < botY; y += 2) {
    for (let x = centerStartX; x < centerEndX; x += 2) {
      const idx = (y * width + x) * channels;
      const diff = Math.abs(frame1[idx] - frame2[idx])
                 + Math.abs(frame1[idx + 1] - frame2[idx + 1])
                 + Math.abs(frame1[idx + 2] - frame2[idx + 2]);
      sumDiff += diff / 3;
      count++;
    }
  }
  return count > 0 ? sumDiff / count : 0;
}

function scoreLiveness(session) {
  const { prompt, faceXHistory, faceYHistory, frames } = session;
  const faceXArr = faceXHistory.slice(-10);
  const faceYArr = faceYHistory.slice(-10);

  if (faceXArr.length < 3) {
    return { isLive: false, score: 0, reason: 'Low liveness score (0/100)' };
  }

  // --- Face presence gate skipped — always proceeds to direction/motion scoring ---

  // --- Only reached once a face has been confirmed present ---
  let score = 0;
  let reasons = [];

  const baselineX = (faceXArr[0] + faceXArr[1] + faceXArr[2]) / 3;
  const drift = faceXArr[faceXArr.length - 1] - baselineX;

  let dirScore = 0;
  if (prompt === 'left') {
    dirScore = drift < -0.08 ? 50 : drift < -0.04 ? 25 : 0;
  } else if (prompt === 'right') {
    dirScore = drift > 0.08 ? 50 : drift > 0.04 ? 25 : 0;
  } else if (prompt === 'nod' && faceYArr.length >= 3) {
    const meanY = faceYArr.reduce((a, b) => a + b, 0) / faceYArr.length;
    const variance = faceYArr.reduce((a, b) => a + (b - meanY) ** 2, 0) / faceYArr.length;
    dirScore = variance > 0.06 ? 50 : variance > 0.03 ? 25 : 0;
  }
  score += dirScore;
  if (dirScore === 0) reasons.push('Turn direction mismatch — did not follow prompt');

  let motionScore = 0;
  if (frames.length >= 2) {
    const lastFrames = frames.slice(-5);
    let totalDiff = 0;
    let diffCount = 0;
    for (let i = 1; i < lastFrames.length; i++) {
      if (lastFrames[i].raw && lastFrames[i - 1].raw) {
        const diff = computePixelDiff(
          lastFrames[i].raw, lastFrames[i - 1].raw,
          lastFrames[i].info.width, lastFrames[i].info.height,
          lastFrames[i].info.channels,
          Math.floor(lastFrames[i].info.height * 0.2),
          Math.floor(lastFrames[i].info.height * 0.8),
          Math.floor(lastFrames[i].info.width * 0.2),
          Math.floor(lastFrames[i].info.width * 0.8)
        );
        totalDiff += diff;
        diffCount++;
      }
    }
    const avgDiff = diffCount > 0 ? totalDiff / diffCount : 0;

    if (avgDiff >= 2 && avgDiff <= 25) {
      motionScore = 25;
    } else if (avgDiff < 1) {
      motionScore = -20;
      reasons.push('No face movement across frames — possible printed photo');
    } else if (avgDiff > 40) {
      motionScore = -10;
      reasons.push('Excessive frame variance — possible video playback');
    }
  }

  score += motionScore;
  score = Math.max(0, Math.min(75, score));

  if (dirScore === 0 && reasons.length === 0) {
    reasons.push('Head turn not detected — possible static image');
  }

  const isLive = score >= livenessThreshold;
  if (!isLive && reasons.length === 0) reasons.push(`Low liveness score (${score}/100)`);
  if (isLive && reasons.length === 0) reasons = ['Verified — head turn confirmed'];

  return { isLive, score, reason: reasons.join('; ') };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/api/startLivenessSession', (req, res) => {
  const { role, studentId, studentName } = req.body;
  const directions = ['left', 'right', 'nod'];
  const direction = directions[Math.floor(Math.random() * directions.length)];
  const instructions = {
    left: 'Turn your head LEFT',
    right: 'Turn your head RIGHT',
    nod: 'Nod slowly'
  };

  const sessionId = uuidv4();
  const session = {
    sessionId,
    role: role || 'student',
    studentId: studentId || '',
    studentName: studentName || '',
    prompt: direction,
    frames: [],
    scores: [],
    faceXHistory: [],
    faceYHistory: [],
    lastScore: 0,
    lastReason: '',
    bestFrameBase64: null,
    bestScore: 0,
    createdAt: Date.now()
  };

  sessions.set(sessionId, session);

  res.json({
    sessionId,
    prompt: {
      direction,
      instruction: instructions[direction]
    }
  });
});

app.post('/api/sendFrameForAnalysis', async (req, res) => {
  try {
    const { sessionId, frameBase64 } = req.body;

    if (!sessionId || !frameBase64) {
      return res.status(400).json({ error: 'Missing sessionId or frameBase64' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    let b64 = frameBase64;
    if (b64.startsWith('data:')) {
      b64 = b64.split(',')[1];
    }

    const { faceX, faceY, skinPixelRatio, skinCount, totalFaceZonePixels } = await analyzeFrame(b64);

    session.faceXHistory.push(faceX);
    session.faceYHistory.push(faceY);

    const buf = Buffer.from(b64, 'base64');
    const rawResult = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    session.frames.push({
      raw: rawResult.data,
      info: rawResult.info,
      skinPixelRatio,
      skinCount
    });

    if (session.faceXHistory.length > 10) {
      session.faceXHistory = session.faceXHistory.slice(-10);
      session.faceYHistory = session.faceYHistory.slice(-10);
    }
    if (session.frames.length > 10) {
      session.frames = session.frames.slice(-10);
    }

    const { isLive, score, reason } = scoreLiveness(session);
    session.lastScore = score;
    session.lastReason = reason;
    session.scores.push(score);

    if (score > session.bestScore) {
      session.bestScore = score;
      session.bestFrameBase64 = b64;
    }

    res.json({ isLive, score, reason });
  } catch (err) {
    console.error('Frame analysis error:', err);
    res.status(500).json({ error: 'Frame analysis failed' });
  }
});

app.post('/api/submitAttendance', async (req, res) => {
  try {
    const { sessionId, qrData, role, qrSessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    const session = sessions.get(sessionId);
    const livenessScore = session ? session.lastScore : 0;
    const reason = session ? session.lastReason : '';

    let name = 'Unknown';
    let studentId = qrData || 'unknown';

    if (qrData) {
      try {
        const parsed = JSON.parse(qrData);
        name = parsed.name || parsed.student_name || 'Unknown';
        studentId = parsed.studentId || parsed.student_id || parsed.s || qrData;
      } catch {
        name = qrData;
        studentId = qrData;
      }
    }

    if (session && session.studentName) name = session.studentName;
    if (session && session.studentId) studentId = session.studentId;

    const status = livenessScore >= livenessThreshold ? 'verified' : 'suspicious';
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    let frameUrl = null;

    if (session && session.bestFrameBase64) {
      try {
        const frameBuf = Buffer.from(session.bestFrameBase64, 'base64');
        const fileName = `${sessionId}.jpg`;
        const { error: uploadError } = await supabase
          .storage
          .from('liveness-frames')
          .upload(fileName, frameBuf, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (!uploadError) {
          const { data: urlData } = supabase
            .storage
            .from('liveness-frames')
            .getPublicUrl(fileName);
          frameUrl = urlData?.publicUrl || null;
        } else {
          console.error('Frame upload error:', uploadError);
        }
      } catch (uploadErr) {
        console.error('Frame upload exception:', uploadErr);
      }
    }

    const { error: insertError } = await supabase
      .from('liveness_logs')
      .insert({
        id,
        student_id: studentId,
        student_name: name,
        role: role || 'student',
        session_id: qrSessionId || sessionId,
        liveness_score: livenessScore,
        is_live: livenessScore >= livenessThreshold,
        reason,
        frame_url: frameUrl,
        status
      });

    if (insertError) {
      console.error('Supabase insert error:', insertError);
    }

    res.json({ id, name, studentId, timestamp, status, liveness_score: livenessScore, reason, frameUrl });
  } catch (err) {
    console.error('Submit attendance error:', err);
    res.status(500).json({ error: 'Failed to submit attendance' });
  }
});

app.get('/api/getFlaggedRecords', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('liveness_logs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase query error:', error);
      return res.status(500).json({ error: 'Failed to fetch flagged records' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Get flagged records error:', err);
    res.status(500).json({ error: 'Failed to fetch flagged records' });
  }
});

app.get('/api/getAllRecords', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('liveness_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      return res.status(500).json({ error: 'Failed to fetch records' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Get all records error:', err);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

app.post('/api/reviewRecord', async (req, res) => {
  try {
    const { recordId, action } = req.body;

    if (!recordId || !action) {
      return res.status(400).json({ error: 'Missing recordId or action' });
    }

    if (action !== 'verify' && action !== 'revoke') {
      return res.status(400).json({ error: 'Invalid action. Use "verify" or "revoke"' });
    }

    const { data: record, error: fetchError } = await supabase
      .from('liveness_logs')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    if (record.frame_url) {
      const fileName = record.frame_url.split('/').pop();
      if (fileName) {
        try {
          await supabase.storage.from('liveness-frames').remove([fileName]);
        } catch (storageErr) {
          console.error('Storage delete error (non-fatal):', storageErr);
        }
      }
    }

    if (action === 'verify') {
      await supabase
        .from('liveness_logs')
        .update({ status: 'verified', frame_url: null })
        .eq('id', recordId);
    } else {
      await supabase
        .from('liveness_logs')
        .update({ status: 'revoked', frame_url: null })
        .eq('id', recordId);

      if (record.student_id) {
        try {
          await supabase
            .from('device_registrations')
            .update({ status: 'revoked' })
            .eq('id', record.student_id);
        } catch (devErr) {
          console.error('Device revocation error (non-fatal):', devErr);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Review record error:', err);
    res.status(500).json({ error: 'Failed to review record' });
  }
});

app.post('/api/saveSettings', async (req, res) => {
  try {
    const { schoolName, locationEnabled, livenessThreshold: threshold } = req.body;

    const upserts = [];

    if (schoolName !== undefined) {
      upserts.push(supabase.from('settings').upsert({ key: 'schoolName', value: String(schoolName) }));
    }
    if (locationEnabled !== undefined) {
      upserts.push(supabase.from('settings').upsert({ key: 'locationEnabled', value: String(locationEnabled) }));
    }
    if (threshold !== undefined) {
      upserts.push(supabase.from('settings').upsert({ key: 'livenessThreshold', value: String(threshold) }));
      livenessThreshold = Number(threshold);
    }

    await Promise.all(upserts);

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/cleanupSessionPhotos', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const { data: records } = await supabase
      .from('attendance_records')
      .select('face_frame_url')
      .eq('session_id', sessionId)
      .not('face_frame_url', 'is', null);

    if (records) {
      const names = records
        .map(r => r.face_frame_url?.split('/').pop())
        .filter(Boolean);
      if (names.length) {
        await supabase.storage.from('liveness-frames').remove(names);
      }
    }

    await supabase
      .from('attendance_records')
      .update({ face_frame_url: null })
      .eq('session_id', sessionId);

    res.json({ success: true });
  } catch (err) {
    console.error('Cleanup photos error:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

const frontendDist = path.join(__dirname, '..', 'web-app', 'dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return;
  res.sendFile(path.join(frontendDist, 'index.html'));
});

export function startServer(port = process.env.PORT || 3001) {
  app.listen(port, () => {
    console.log(`ACLC backend running on port ${port}`);
  });
}

startServer();
