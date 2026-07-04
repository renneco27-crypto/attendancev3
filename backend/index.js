import express from 'express';
import cors from 'cors';
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

setInterval(async () => {
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
  await supabase
    .from('device_registrations')
    .delete()
    .lt('created_at', cutoff)
    .in('status', ['pending', 'revoked']);
}, 6 * 60 * 60 * 1000);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
    }

    await Promise.all(upserts);

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/submitAttendanceFinal', async (req, res) => {
  try {
    const { sessionId, qrSessionId, studentId, studentName, section, frameBase64, gesture, role } = req.body;

    if (!sessionId || !studentId) {
      return res.status(400).json({ error: 'Missing sessionId or studentId' });
    }

    let name = studentName || 'Unknown';
    let frameUrl = null;

    // Upload the frame if provided
    if (frameBase64) {
      let b64 = frameBase64;
      if (b64.startsWith('data:')) b64 = b64.split(',')[1];
      try {
        const frameBuf = Buffer.from(b64, 'base64');
        const fileName = `${uuidv4()}.jpg`;
        const { error: uploadError } = await supabase
          .storage.from('liveness-frames')
          .upload(fileName, frameBuf, { contentType: 'image/jpeg', upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('liveness-frames').getPublicUrl(fileName);
          frameUrl = urlData?.publicUrl || null;
        }
      } catch (uploadErr) {
        console.error('Frame upload exception:', uploadErr);
      }
    }

    const timestamp = new Date().toISOString();
    const id = uuidv4();

    // Insert into liveness_logs (client verified — mark as live)
    const { error: insertError } = await supabase
      .from('liveness_logs')
      .insert({
        id,
        student_id: studentId,
        student_name: name,
        role: role || 'student',
        session_id: qrSessionId || sessionId,
        liveness_score: 100,
        is_live: true,
        reason: 'Verified — client-side liveness pass',
        frame_url: frameUrl,
        status: 'verified',
        prompt: gesture || '',
        detected_direction: gesture || ''
      });

    if (insertError) {
      console.error('Supabase insert error:', insertError);
    }

    // Insert into attendance_records
    const { data: inserted } = await supabase
      .from('attendance_records')
      .insert({
        session_id: qrSessionId || sessionId,
        student_id: studentId,
        student_name: name,
        section: section || '',
        face_frame_url: frameUrl || null,
        is_mock_location: false
      })
      .select('id')
      .single();

    res.json({
      id,
      name,
      studentId,
      timestamp,
      status: 'verified',
      liveness_score: 100,
      frameUrl,
      prompt: gesture || '',
      detected_direction: gesture || '',
      attendanceId: inserted?.id || null
    });
  } catch (err) {
    console.error('Submit attendance final error:', err);
    res.status(500).json({ error: 'Failed to submit attendance' });
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
