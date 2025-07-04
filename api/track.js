require('dotenv').config();
const fetch = require('node-fetch');
const crypto = require('crypto');

// List of allowed domains
const ALLOWED_ORIGINS = [
    'https://fb-kamil.surge.sh',
    'https://rdstrading007.com',
    'https://fp-solution.vercel.app',
    'http://localhost:3000' // For development
];

module.exports = async function handler(req, res) {
    const origin = req.headers.origin || 'unknown';
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const timestamp = new Date().toISOString();
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Bot detection
    if (userAgent.toLowerCase().includes('bot') || userAgent.toLowerCase().includes('crawler')) {
        console.warn(`⚠️ Bot Detected: ${userAgent} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        return res.status(400).json({ error: 'Bot detected' });
    }

    // CORS pre-flight handling
    if (req.method === 'OPTIONS') {
        if (ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            return res.status(200).end();
        } else {
            console.warn(`⚠️ CORS Preflight Rejected: Invalid origin ${origin} from IP ${clientIp} at ${timestamp}`);
            return res.status(403).json({ error: 'Forbidden: Invalid origin in preflight' });
        }
    }

    // Only POST method is allowed
    if (req.method !== 'POST') {
        console.error(`🚫 Method Not Allowed: ${req.method} request from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        return res.status(405).json({ error: 'Method not allowed', method: req.method });
    }

    // Domain validation
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        console.error(`🚫 Forbidden: Invalid origin ${origin} from IP ${clientIp} at ${timestamp}`);
        return res.status(403).json({
            error: 'Forbidden: Invalid origin',
            origin,
            timestamp
        });
    }

    const pixel_id = '1395230681787715';
    const access_token = process.env.FB_ACCESS_TOKEN;

    // FB_ACCESS_TOKEN check
    if (!access_token) {
        console.error(`🚫 Server Configuration Error: FB_ACCESS_TOKEN missing at ${timestamp}`);
        return res.status(500).json({ error: 'Server configuration error: Missing FB_ACCESS_TOKEN' });
    }

    // Input destructuring
    const {
        event_name,
        event_source_url,
        event_id,
        event_time,
        user_data = {},
        custom_data = {}
    } = req.body;

    // Required field validation
    const missingFields = [];
    if (!event_name) missingFields.push('event_name');
    if (!event_source_url) missingFields.push('event_source_url');
    if (!event_id) missingFields.push('event_id');
    if (!event_time) missingFields.push('event_time');
    if (missingFields.length > 0) {
        console.error(`🚫 Missing Required Fields: ${missingFields.join(', ')} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        return res.status(400).json({ error: 'Missing required fields', missing: missingFields });
    }

    // Event Time Validation
    const currentTime = Math.floor(Date.now() / 1000);
    let validatedEventTime = Number.isInteger(Number(event_time)) ? Number(event_time) : currentTime;
    if (validatedEventTime < currentTime - 7 * 24 * 60 * 60 || validatedEventTime > currentTime + 60) {
        console.warn(`⚠️ Invalid event_time: ${validatedEventTime}. Adjusting to current time: ${currentTime} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        validatedEventTime = currentTime;
    }

    // Helper function to generate fbp
    const generateFbp = () => {
        const version = 'fb';
        const subdomainIndex = 1;
        const creationTime = validatedEventTime; // Use validated event time for consistency
        const randomNumber = Math.floor(Math.random() * 10000000000);
        const fbp = `${version}.${subdomainIndex}.${creationTime}.${randomNumber}`;
        console.log(`Generated fbp in backend: ${fbp} at ${timestamp}`);
        return fbp;
    };

    // user_data Validation function
    const validateUserData = (user_data) => {
        if (!user_data || typeof user_data !== 'object') {
            console.warn(`⚠️ Invalid user_data: not an object from ${origin} (IP: ${clientIp}) at ${timestamp}`, user_data);
            return { fbp: generateFbp(), fbc: '' };
        }

        const { fbp = '', fbc = '', fbclid = '' } = user_data;

        // fbp and fbc format validation
        const fbpRegex = /^fb\.\d+\.\d+\.\d+\.\d+$/;
        const fbcRegex = /^fb\.\d+\.\d+\..+$/;
        
        // Validate creationTime in fbp
        let validatedFbp = fbp;
        if (typeof fbp === 'string' && fbpRegex.test(fbp)) {
            const fbpCreationTime = parseInt(fbp.split('.')[2], 10);
            if (fbpCreationTime < currentTime - 7 * 24 * 60 * 60 || fbpCreationTime > currentTime + 60) {
                console.warn(`⚠️ Invalid fbp creationTime: ${fbpCreationTime}. Regenerating fbp from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                validatedFbp = generateFbp();
            }
        } else {
            console.warn(`⚠️ Invalid fbp format: ${fbp}. Regenerating fbp from ${origin} (IP: ${clientIp}) at ${timestamp}`);
            validatedFbp = generateFbp();
        }

        // Validate creationTime in fbc
        let validatedFbc = fbc;
        if (typeof fbc === 'string' && fbcRegex.test(fbc)) {
            const fbcCreationTime = parseInt(fbc.split('.')[2], 10);
            if (fbcCreationTime < currentTime - 7 * 24 * 60 * 60 || fbcCreationTime > currentTime + 60) {
                console.warn(`⚠️ Invalid fbc creationTime: ${fbcCreationTime}. Regenerating fbc from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                validatedFbc = fbclid ? `fb.1.${validatedEventTime}.${fbclid}` : '';
            }
        } else {
            validatedFbc = fbclid ? `fb.1.${validatedEventTime}.${fbclid}` : '';
        }

        return { fbp: validatedFbp, fbc: validatedFbc };
    };

    const { fbp, fbc } = validateUserData(user_data);

    // custom_data Validation
    const validateCustomData = (custom_data) => {
        if (!custom_data || typeof custom_data !== 'object') {
            return {};
        }
        const validCustomData = {};
        if (typeof custom_data.value === 'number') validCustomData.value = custom_data.value;
        if (typeof custom_data.currency === 'string') validCustomData.currency = custom_data.currency;
        if (Array.isArray(custom_data.content_ids)) validCustomData.content_ids = custom_data.content_ids;
        if (typeof custom_data.content_type === 'string') validCustomData.content_type = custom_data.content_type;
        if (typeof custom_data.content_category === 'string') validCustomData.content_category = custom_data.content_category;
        return validCustomData;
    };

    // Event data creation
    const body = {
        data: [
            {
                event_name: typeof event_name === 'string' ? event_name : 'UnknownEvent',
                event_time: validatedEventTime,
                action_source: 'website',
                event_source_url: typeof event_source_url === 'string' ? event_source_url : '',
                event_id: typeof event_id === 'string' ? event_id : generateEventId('UnknownEvent'),
                user_data: {
                    client_ip_address: typeof clientIp === 'string' ? clientIp : '',
                    client_user_agent: userAgent,
                    fbp,
                    ...(fbc ? { fbc } : {})
                },
                custom_data: validateCustomData(custom_data)
            }
        ]
    };

    // Event logging
    console.log(`✅ Sending to Facebook: ${JSON.stringify(body, null, 2)} from ${origin} (IP: ${clientIp}) at ${timestamp}`);

    // Sending events to the Facebook API
    try {
        const fbRes = await fetch(
            `https://graph.facebook.com/v20.0/${pixel_id}/events?access_token=${access_token}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        );

        const fbData = await fbRes.json();

        if (!fbRes.ok) {
            console.error(`🚫 Facebook API Error: ${JSON.stringify(fbData, null, 2)} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
            return res.status(500).json({ error: 'Facebook API error', details: fbData });
        }

        console.log(`✅ Facebook API Success: ${JSON.stringify(fbData, null, 2)} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        return res.status(200).json(fbData);
    } catch (error) {
        console.error(`🚫 Fetch Error: ${error.message} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

// Generating unique event ID (backup on server)
function generateEventId(name) {
    return `${name}-${crypto.randomUUID()}`;
}