// api/track.js
require('dotenv').config();

// অনুমোদিত ডোমেইনগুলোর লিস্ট
const ALLOWED_ORIGINS = [
  'https://fb-kamil.surge.sh',
  'https://client1.com',
  'https://client2.com',
  'http://localhost:3000' // ডেভেলপমেন্টের জন্য
];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || 'unknown';
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const timestamp = new Date().toISOString();

  // CORS প্রি-ফ্লাইট হ্যান্ডলিং
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

  // শুধুমাত্র POST মেথড অনুমোদিত
  if (req.method !== 'POST') {
    console.error(`🚫 Method Not Allowed: ${req.method} request from ${origin} (IP: ${clientIp}) at ${timestamp}`);
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  // ডোমেইন ভ্যালিডেশন
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

  // FB_ACCESS_TOKEN চেক
  if (!access_token) {
    console.error(`🚫 Server Configuration Error: FB_ACCESS_TOKEN missing at ${timestamp}`);
    return res.status(500).json({ error: 'Server configuration error: Missing FB_ACCESS_TOKEN' });
  }

  // ইনপুট ডিস্ট্রাকচারিং
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

  // প্রয়োজনীয় ফিল্ড ভ্যালিডেশন
  if (!event_name || !event_source_url || !event_id || !event_time) {
    console.error(`🚫 Missing Required Fields: ${JSON.stringify({ event_name, event_source_url, event_id, event_time }, null, 2)} from ${origin} (IP: ${clientIp}) at ${timestamp}`);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // user_data ভ্যালিডেশন ফাংশন
  const validateUserData = (user_data) => {
    if (!user_data || typeof user_data !== 'object') {
      console.warn(`⚠️ Invalid user_data: not an object from ${origin} (IP: ${clientIp}) at ${timestamp}`, user_data);
      return { fbp: '', fbc: '' };
    }

    const { fbp = '', fbc = '' } = user_data;

    // fbp এবং fbc ফরম্যাট ভ্যালিডেশন
    const fbpRegex = /^fb\.\d+\.\d+\.\d+\.\d+$/;
    const fbcRegex = /^fb\.\d+\.click\..+$/;
    const validatedFbp = typeof fbp === 'string' && fbpRegex.test(fbp) ? fbp : '';
    const validatedFbc = typeof fbc === 'string' && fbcRegex.test(fbc) ? fbc : '';

    return { fbp: validatedFbp, fbc: validatedFbc };
  };

  const { fbp, fbc } = validateUserData(user_data);

  // custom_data ভ্যালিডেশন
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

  // ইভেন্ট টাইম ভ্যালিডেশন
  const validatedEventTime = Number.isInteger(Number(event_time)) ? Number(event_time) : Math.floor(Date.now() / 1000);

  // ইভেন্ট ডেটা তৈরি
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

  // ইভেন্ট লগ করা
  console.log(`✅ Sent to Facebook: ${JSON.stringify(body, null, 2)} from ${origin} (IP: ${clientIp}) at ${timestamp}`);

  // ফেসবুক API-তে ইভেন্ট পাঠানো
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

// ইউনিক ইভেন্ট আইডি জেনারেট করা (সার্ভারে ব্যাকআপ)
function generateEventId(name) {
  return `${name}-${crypto.randomUUID()}`;
}