const { createClient } = require('@supabase/supabase-js');
const formidable = require('formidable');
const fs = require('fs');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const createSupabaseClient = () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return null;
    }

    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
};

const normalizeField = (value) => {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
        res.status(500).json({ error: 'Supabase não configurado.' });
        return;
    }

    const form = formidable({
        multiples: false,
        maxFileSize: 10 * 1024 * 1024,
        allowEmptyFiles: false
    });

    form.parse(req, async (err, fields, files) => {
        if (err) {
            res.status(400).json({ error: 'Falha ao processar o formulário.' });
            return;
        }

        const nome = normalizeField(fields.nome) || '';
        const whatsapp = normalizeField(fields.whatsapp) || '';
        const cidade = normalizeField(fields.cidade) || '';
        const estado = normalizeField(fields.estado) || '';
        const promptText = normalizeField(fields.prompt_text) || '';

        const fileField = files.kml;
        const file = Array.isArray(fileField) ? fileField[0] : fileField;

        if (!file) {
            res.status(400).json({ error: 'Arquivo KML não encontrado.' });
            return;
        }

        const filePath = file.filepath || file.path;
        const originalName = file.originalFilename || file.name || 'arquivo.kml';
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const leadId = crypto.randomUUID();
        const storagePath = `leads/${leadId}/${safeName}`;

        try {
            const buffer = await fs.promises.readFile(filePath);
            const { data: storageData, error: storageError } = await supabase
                .storage
                .from('kml-uploads')
                .upload(storagePath, buffer, {
                    contentType: file.mimetype || 'application/vnd.google-earth.kml+xml',
                    upsert: false
                });

            if (storageError) {
                res.status(500).json({ error: 'Falha ao salvar o arquivo.' });
                return;
            }

            const ipAddress = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || null;
            const userAgent = req.headers['user-agent'] || null;

            const { error: insertError } = await supabase
                .from('lead_submissions')
                .insert({
                    nome,
                    whatsapp,
                    cidade,
                    estado,
                    prompt_text: promptText,
                    kml_path: storageData.path,
                    kml_filename: safeName,
                    ip_address: ipAddress,
                    user_agent: userAgent
                });

            if (insertError) {
                res.status(500).json({ error: 'Falha ao salvar os dados.' });
                return;
            }

            res.status(200).json({ ok: true });
        } catch (uploadErr) {
            res.status(500).json({ error: 'Erro inesperado ao processar o envio.' });
        }
    });
};

module.exports.config = {
    api: {
        bodyParser: false
    }
};
