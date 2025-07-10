// api/track-event.js
import { URL } from 'url';

export default async function handler(req, res) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
  const requestOrigin = req.headers.origin;

  let isOriginAllowed = false;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    isOriginAllowed = true;
  } else if (allowedOrigins.length === 0) {
    console.warn('WARNING: ALLOWED_ORIGINS env var not set. Allowing all origins. Configure for production security.');
    isOriginAllowed = true;
  }

  // CORS Headers
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', 86400);
  res.setHeader('Access-Control-Allow-Credentials', 'true'); 

  if (isOriginAllowed && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  } else if (requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || 'null');
  }

  // Handle preflight (OPTIONS) requests
  if (req.method === 'OPTIONS') {
    console.log(`Received OPTIONS preflight from ${requestOrigin}. Allowed: ${isOriginAllowed}.`);
    if (!isOriginAllowed && allowedOrigins.length > 0) {
      console.warn(`SECURITY WARNING: Preflight from unauthorized origin: ${requestOrigin}. Returning 403 Forbidden.`);
      return res.status(403).json({ success: false, message: 'Forbidden: Origin not allowed.' });
    }
    return res.status(200).end(); 
  }

  // Ensure POST request and authorized origin
  if (req.method !== 'POST') {
    console.error(`ERROR: Method Not Allowed. Received ${req.method} from ${requestOrigin}.`);
    return res.status(405).json({ success: false, message: 'Method Not Allowed.' });
  }
  if (!isOriginAllowed && allowedOrigins.length > 0) {
    console.warn(`SECURITY WARNING: POST from unauthorized origin: ${requestOrigin}. Returning 403 Forbidden.`);
    return res.status(403).json({ success: false, message: 'Forbidden: Origin not allowed.' });
  }

  // Get Facebook credentials
  const PIXEL_ID = process.env.FACEBOOK_PIXEL_ID;
  const ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('ERROR: FB credentials not configured. Check Vercel Env Vars.');
    return res.status(500).json({ success: false, message: 'FB credentials not configured.' });
  }

  // Extract payload from request (includes eventName, buttonName, pageUrl, fbc, fbp, eventId, value, currency)
  const { eventName, buttonName, pageUrl, fbc, fbp, eventId, value, currency } = req.body;

  // Prepare user data
  const userData = {
    client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    client_user_agent: req.headers['user-agent'],
  };
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  // Log received payload
  console.log('Received payload from frontend:', { 
    eventName, pageUrl, eventId, fbc_present: !!fbc, fbp_present: !!fbp,
    client_ip_address: userData.client_ip_address, client_user_agent: userData.client_user_agent,
    request_origin: requestOrigin,
    event_value: value, 
    event_currency: currency 
  });

  // Build event payload for Facebook
const eventPayload = {
  event_name: eventName, 
  // event_time: Math.floor(Date.now() / 1000), // Original line - to be modified

  // --- NEW: Derive event_time from _fbc cookie if possible, else use current time ---
  event_time: Math.floor(Date.now() / 1000), // Default to current time
  action_source: 'website', 
  event_source_url: pageUrl,
  user_data: userData, 
  event_id: eventId, 
  // test_event_code: 'TEST12345', // REMOVE FOR PRODUCTION!
};

// If fbc cookie is available, try to extract its creation time (first part of _fbc)
// _fbc format: creationTime.version.subdomainIndex.sequenceNumber.fbc
if (fbc) {
    const fbcParts = fbc.split('.');
    if (fbcParts.length >= 2 && !isNaN(parseInt(fbcParts[0]))) {
        const fbcCreationTimeMs = parseInt(fbcParts[0]); // fbc creation time is in milliseconds
        // Use the fbc creation time, converting it to seconds for event_time
        eventPayload.event_time = Math.floor(fbcCreationTimeMs / 1000);
    }
}
// --- END NEW ---

// Conditionally add custom_data and standard value/currency
eventPayload.custom_data = {
    button_name: buttonName || eventName,
    ...(value !== undefined && value !== null && {
      value: value,
      currency: currency || 'BDT',
    }),
};

  // --- End Updated ---

  // Send event to Facebook
  try {
    console.log(`Attempting to send '${eventName}' to Facebook.`);
    const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventPayload] }),
    });
    const fbData = await fbResponse.json();
    console.log('Facebook API Raw Response:', fbData);

    if (fbData.error) {
        console.error('ERROR: FB API reported an error:', fbData.error);
        return res.status(500).json({ success: false, message: 'FB API Error', error: fbData.error });
    }
    if (fbData.events_received && fbData.events_received > 0) {
        console.log(`SUCCESS: '${eventName}' sent to FB. Events received: ${fbData.events_received}`);
    } else {
        console.warn(`WARNING: '${eventName}' sent to FB, but no events received confirmation. FB Response:`, fbData);
    }
    res.status(200).json({ success: true, message: `'${eventName}' sent to FB`, facebookResponse: fbData });

  } catch (error) {
    console.error('ERROR: Failed to send to FB (network/unexpected):', error);
    res.status(500).json({ success: false, message: 'Failed to send to FB', error: error.message });
  }
}
