const fs = require('fs');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cachedSupabaseModule = null;
let cachedFormidableModule = null;

const loadSupabaseModule = async () => {
    if (cachedSupabaseModule) {
        return cachedSupabaseModule;
    }

    try {
        cachedSupabaseModule = require('@supabase/supabase-js');
        return cachedSupabaseModule;
    } catch (err) {
        if (err && err.code === 'ERR_REQUIRE_ESM') {
            const mod = await import('@supabase/supabase-js');
            cachedSupabaseModule = mod;
            return mod;
        }
        throw err;
    }
};

const loadFormidableModule = async () => {
    if (cachedFormidableModule) {
        return cachedFormidableModule;
    }

    try {
        cachedFormidableModule = require('formidable');
        return cachedFormidableModule;
    } catch (err) {
        if (err && err.code === 'ERR_REQUIRE_ESM') {
            const mod = await import('formidable');
            cachedFormidableModule = mod;
            return mod;
        }
        throw err;
    }
};

const getCreateClient = async () => {
    const mod = await loadSupabaseModule();
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (!createClient) {
        throw new Error('createClient não encontrado no módulo Supabase.');
    }
    return createClient;
};

const getFormidableFactory = async () => {
    const mod = await loadFormidableModule();
    if (typeof mod === 'function') {
        return mod;
    }
    if (mod && typeof mod.formidable === 'function') {
        return mod.formidable;
    }
    if (mod && mod.default && typeof mod.default === 'function') {
        return mod.default;
    }
    if (mod && mod.default && typeof mod.default.formidable === 'function') {
        return mod.default.formidable;
    }
    throw new Error('Formidable não encontrado no módulo.');
};

const createSupabaseClient = async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return null;
    }

    const createClient = await getCreateClient();
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

const generateLeadId = () => {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
};

const logError = (label, err) => {
    console.error(`[lead] ${label}`, err);
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    let supabase = null;
    try {
        supabase = await createSupabaseClient();
    } catch (err) {
        logError('Falha ao iniciar Supabase', err);
        res.status(500).json({ error: 'Falha ao iniciar o serviço.' });
        return;
    }

    if (!supabase) {
        res.status(500).json({ error: 'Supabase não configurado.' });
        return;
    }

    let formFactory = null;
    try {
        formFactory = await getFormidableFactory();
    } catch (err) {
        logError('Falha ao carregar Formidable', err);
        res.status(500).json({ error: 'Dependências do servidor ausentes.' });
        return;
    }

    const form = formFactory({
        multiples: false,
        maxFileSize: 10 * 1024 * 1024,
        allowEmptyFiles: false
    });

    form.parse(req, async (err, fields, files) => {
        if (err) {
            logError('Falha ao processar formulário', err);
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
        const leadId = generateLeadId();
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
                logError('Falha ao salvar arquivo no Supabase Storage', storageError);
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
                logError('Falha ao inserir lead no Supabase', insertError);
                res.status(500).json({ error: 'Falha ao salvar os dados.' });
                return;
            }

            res.status(200).json({ ok: true });
        } catch (uploadErr) {
            logError('Erro inesperado ao processar envio', uploadErr);
            res.status(500).json({ error: 'Erro inesperado ao processar o envio.' });
        }
    });
};

module.exports.config = {
    api: {
        bodyParser: false
    }
};
