// server.js (or api/track.js for Vercel)
require('dotenv').config();

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGINS = ['https://facebook-track.vercel.app']; // Add client domain
  const origin = req.headers.origin;

  // CORS pre-flight handling
  if (req.method === 'OPTIONS') {
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    console.error('Forbidden: Invalid origin', origin);
    return res.status(403).json({ error: 'Forbidden: Invalid origin' });
  }

  const pixel_id = '1211731600730925';
  const access_token = process.env.FB_ACCESS_TOKEN;

  if (!access_token) {
    console.error('FB_ACCESS_TOKEN is not set in environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Input destructuring
  const {
    event_name,
    event_source_url,
    value,
    currency,
    event_id,
    event_time,
    user_data = {},
    custom_data = {}
  } = req.body;

  // Required field validation
  if (!event_name || !event_source_url || !event_id || !event_time) {
    console.error('Missing required fields:', { event_name, event_source_url, event_id, event_time });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // user_data validation function
  const validateUserData = (user_data) => {
    if (!user_data || typeof user_data !== 'object') {
      console.warn('Invalid user_data: not an object', user_data);
      return { fbp: '', fbc: '' };
    }

    const { fbp = '', fbc = '' } = user_data;

    // fbp and fbc for altogether
    const fbpRegex = /^fb\.\d+\.\d+\.\d+\.\d+$/;
    const fbcRegex = /^fb\.\d+\.click\..+$/;
    const validatedFbp = typeof fbp === 'string' && fbpRegex.test(fbp) ? fbp : '';
    const validatedFbc = typeof fbc === 'string' && fbcRegex.test(fbc) ? fbc : '';

    return { fbp: validatedFbp, fbc: validatedFbc };
  };

  const { fbp, fbc } = validateUserData(user_data);

  // custom_data validation
  const validateCustomData = (custom_data) => {
    if (!custom_data || typeof custom_data !== 'object') {
      return {};
    }
    const validCustomData = {};
    if (typeof custom_data.value === 'number') validCustomData.value = custom_data.value;
    if (typeof custom_data.currency === 'string') validCustomData.currency = custom_data.currency;
    if (typeof custom_data.content_ids === 'object') validCustomData.content_ids = custom_data.content_ids;
    if (typeof custom_data.content_type === 'string') validCustomData.content_type = custom_data.content_type;
    if (typeof custom_data.content_category === 'string') validCustomData.content_category = custom_data.content_category;
    return validCustomData;
  };

  // Event Time Validation
  const validatedEventTime = Number.isInteger(Number(event_time)) ? Number(event_time) : Math.floor(Date.now() / 1000);

  const clientIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

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
          client_user_agent: req.headers['user-agent'] || '',
          ...(fbp ? { fbp } : {}),
          ...(fbc ? { fbc } : {})
        },
        custom_data: validateCustomData(custom_data)
      },
    ],
  };

  console.log('✅ Sent to Facebook:', JSON.stringify(body, null, 2));

  try {
    const fbRes = await fetch(
      `https://graph.facebook.com/v19.0/${pixel_id}/events?access_token=${access_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    const fbData = await fbRes.json();

    if (!fbRes.ok) {
      console.error('Facebook API Error:', fbData);
      return res.status(500).json({ error: 'Facebook API error', details: fbData });
    }

    console.log('Facebook API Success:', fbData);
    return res.status(200).json(fbData);
  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Generating unique event ID (backup on server)
function generateEventId(name) {
  return `${name}-${crypto.randomUUID()}`;
}