require('dotenv').config();
const fetch = require('node-fetch');
const crypto = require('crypto');

// List of allowed domains
const ALLOWED_ORIGINS = [
    'https://fb-kamil.surge.sh',
    'https://rdstrading007.com',
    'https://fp-solution.vercel.app',
    'http://localhost:3000'
];

module.exports = async function handler(req, res) {
    const origin = req.headers.origin || 'unknown';
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const timestamp = new Date().toISOString();
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Log request receipt for debugging
    console.log(`📥 Received request: method=${req.method}, origin=${origin}, IP=${clientIp}, userAgent=${userAgent} at ${timestamp}`);

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
            console.log(`✅ CORS preflight approved for ${origin} at ${timestamp}`);
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

    // Extract fbclid time if available
    const fbclid = user_data?.fbclid || '';
    const fbclidTimeMatch = fbclid.match(/_\d+$/);
    const fbclidTime = fbclidTimeMatch ? parseInt(fbclidTimeMatch[0].slice(1), 10) : null;

    // Validate event_time against fbclid time
    if (fbclidTime && !isNaN(fbclidTime)) {
        if (validatedEventTime < fbclidTime) {
            console.warn(`⚠️ event_time (${validatedEventTime}) is earlier than fbclid time (${fbclidTime}). Adjusting to fbclid time from ${origin} (IP: ${clientIp}) at ${timestamp}`);
            validatedEventTime = fbclidTime;
        }
    }

    // Validate against general time window
    if (validatedEventTime < currentTime - 7 * 24 * 60 * 60 || validatedEventTime > currentTime + 60) {
        console.warn(`⚠️ Invalid event_time: ${validatedEventTime}. Adjusting to current time: ${currentTime} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
        validatedEventTime = currentTime;
    }

    // Helper function to generate fbp
    const generateFbp = () => {
        const version = 'fb';
        const subdomainIndex = 1;
        const creationTime = validatedEventTime;
        const randomNumber = Math.floor(Math.random() * 10000000000);
        const fbp = `${version}.${subdomainIndex}.${creationTime}.${randomNumber}`;
        console.log(`Generated fbp in backend: ${fbp} at ${timestamp}`);
        return fbp;
    };

    // Helper function to generate fbc
    const generateFbc = (fbclid) => {
        const version = 'fb';
        const subdomainIndex = 1;
        const creationTime = validatedEventTime;
        const fbc = `${version}.${subdomainIndex}.${creationTime}.${fbclid}`;
        console.log(`Generated fbc in backend: ${fbc} at ${timestamp}`);
        return fbc;
    };

    // user_data Validation function
    const validateUserData = (user_data) => {
        if (!user_data || typeof user_data !== 'object') {
            console.warn(`⚠️ Invalid user_data: not an object from ${origin} (IP: ${clientIp}) at ${timestamp}`, user_data);
            return { fbp: generateFbp(), fbc: '' };
        }

        let { fbp = '', fbc = '', fbclid = '' } = user_data;

        // fbp format validation
        const fbpRegex = /^fb\.\d+\.\d+\.\d+$/;
        let validatedFbp = fbp;
        if (typeof fbp === 'string') {
            const fbpParts = fbp.split('.');
            if (fbpParts.length > 4) {
                console.warn(`⚠️ Malformed fbp with too many components: ${fbp}. Fixing to first four components from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                fbp = `fb.${fbpParts[1]}.${fbpParts[2]}.${fbpParts[3]}`;
            }
            if (fbpRegex.test(fbp)) {
                let creationTime = parseInt(fbp.split('.')[2], 10);
                if (creationTime > currentTime * 1000) {
                    console.warn(`⚠️ fbp creationTime appears to be in milliseconds: ${creationTime}. Converting to seconds from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                    creationTime = Math.floor(creationTime / 1000);
                    fbp = fbp.split('.').slice(0, 2).concat([creationTime], fbp.split('.').slice(3)).join('.');
                }
                if (isNaN(creationTime) || creationTime < currentTime - 7 * 24 * 60 * 60 || creationTime > currentTime + 60) {
                    console.warn(`⚠️ Invalid fbp creationTime: ${creationTime}. Regenerating fbp from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                    validatedFbp = generateFbp();
                }
            } else {
                console.warn(`⚠️ Invalid fbp format: ${fbp}. Regenerating fbp from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                validatedFbp = generateFbp();
            }
        } else {
            console.warn(`⚠️ Invalid fbp type: ${typeof fbp}. Regenerating fbp from ${origin} (IP: ${clientIp}) at ${timestamp}`);
            validatedFbp = generateFbp();
        }

        // fbc format validation
        const fbcRegex = /^fb\.\d+\.\d+\..+$/;
        let validatedFbc = fbc;
        if (typeof fbc === 'string' && fbcRegex.test(fbc)) {
            let fbcParts = fbc.split('.');
            let fbcCreationTime = parseInt(fbcParts[2], 10);
            if (fbcCreationTime > currentTime * 1000) {
                console.warn(`⚠️ fbc creationTime appears to be in milliseconds: ${fbcCreationTime}. Converting to seconds from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                fbcCreationTime = Math.floor(fbcCreationTime / 1000);
                fbcParts[2] = fbcCreationTime;
                fbc = fbcParts.join('.');
            }
            if (isNaN(fbcCreationTime) || fbcCreationTime < currentTime - 7 * 24 * 60 * 60 || fbcCreationTime > currentTime + 60) {
                console.warn(`⚠️ Invalid fbc creationTime: ${fbcCreationTime}. Regenerating fbc from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                validatedFbc = fbclid ? generateFbc(fbclid) : '';
            } else {
                validatedFbc = fbc;
            }
        } else {
            validatedFbc = fbclid ? generateFbc(fbclid) : '';
        }

        return { fbp: validatedFbp, fbc: validatedFbc };
    };

    const { fbp, fbc } = validateUserData(user_data);

    // custom_data Validation
    const validateCustomData = (custom_data, event_name) => {
        if (!custom_data || typeof custom_data !== 'object') {
            console.warn(`⚠️ Invalid custom_data: not an object for ${event_name} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
            return event_name === 'ClaimNowClick' ? { value: 10.0, currency: 'USD' } : {};
        }

        const validCustomData = {};

        // Validate value for ClaimNowClick
        if (event_name === 'ClaimNowClick') {
            if (typeof custom_data.value !== 'number' || isNaN(custom_data.value) || custom_data.value < 0) {
                console.warn(`⚠️ Invalid or missing value for ClaimNowClick: ${custom_data.value}. Setting default to 10.0 from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                validCustomData.value = 10.0; // Default value, adjust as needed
            } else {
                validCustomData.value = custom_data.value;
            }
        } else if (typeof custom_data.value === 'number' && !isNaN(custom_data.value)) {
            validCustomData.value = custom_data.value;
        }

        // Validate currency for ClaimNowClick
        if (event_name === 'ClaimNowClick') {
            if (typeof custom_data.currency !== 'string' || !/^[A-Z]{3}$/.test(custom_data.currency)) {
                console.warn(`⚠️ Invalid or missing currency for ClaimNowClick: ${custom_data.currency}. Setting default to USD from ${origin} (IP: ${clientIp}) at ${timestamp}`);
                validCustomData.currency = 'USD'; // Use 'BDT' for Bangladesh if applicable
            } else {
                validCustomData.currency = custom_data.currency;
            }
        } else if (typeof custom_data.currency === 'string' && /^[A-Z]{3}$/.test(custom_data.currency)) {
            validCustomData.currency = custom_data.currency;
        }

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
                custom_data: validateCustomData(custom_data, event_name)
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