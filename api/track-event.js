// api/track-event.js
import { URL } from 'url';

export default async function handler(req, res) {
  // Define allowed origins for CORS.
  // Get ALLOWED_ORIGINS from Vercel Environment Variables. Example: "https://yourlandingpage.com,https://www.yourlandingpage.com"
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
  const requestOrigin = req.headers.origin;

  let isOriginAllowed = false;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    isOriginAllowed = true;
  } else if (allowedOrigins.length === 0) {
    console.warn('WARNING: ALLOWED_ORIGINS env var not set. Allowing all origins. Configure for production security.');
    isOriginAllowed = true;
  }

  // Set common CORS Headers.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', 86400); // Cache preflight response for 24 hours
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // Required when client uses `credentials: 'include'`

  // Set Access-Control-Allow-Origin header based on whether the origin is allowed.
  if (isOriginAllowed && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  } else if (requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || 'null'); // Set to a dummy or first allowed origin to fail browser check
  }

  // Handle preflight (OPTIONS) requests.
  if (req.method === 'OPTIONS') {
    console.log(`Received OPTIONS preflight from ${requestOrigin}. Allowed: ${isOriginAllowed}.`);
    if (!isOriginAllowed && allowedOrigins.length > 0) {
      console.warn(`SECURITY WARNING: Preflight from unauthorized origin: ${requestOrigin}. Returning 403 Forbidden.`);
      return res.status(403).json({ success: false, message: 'Forbidden: Origin not allowed.' });
    }
    return res.status(200).end(); 
  }

  // Ensure it's a POST request and from an authorized origin.
  if (req.method !== 'POST') {
    console.error(`ERROR: Method Not Allowed. Received ${req.method} from ${requestOrigin}.`);
    return res.status(405).json({ success: false, message: 'Method Not Allowed.' });
  }
  if (!isOriginAllowed && allowedOrigins.length > 0) {
    console.warn(`SECURITY WARNING: POST from unauthorized origin: ${requestOrigin}. Returning 403 Forbidden.`);
    return res.status(403).json({ success: false, message: 'Forbidden: Origin not allowed.' });
  }

  // Get Facebook credentials from Vercel Environment Variables.
  const PIXEL_ID = process.env.FACEBOOK_PIXEL_ID;
  const ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('ERROR: FB credentials not configured. Check Vercel Env Vars (FACEBOOK_PIXEL_ID, FACEBOOK_ACCESS_TOKEN).');
    return res.status(500).json({ success: false, message: 'FB credentials not configured.' });
  }

  // Extract payload from the request body.
  const { eventName, buttonName, pageUrl, fbc, fbp, eventId, value, currency } = req.body;

  // Prepare user data for Facebook.
  const userData = {
    client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    client_user_agent: req.headers['user-agent'],
  };
  if (fbc) userData.fbc = fbc; // Include fbc parameter if present
  if (fbp) userData.fbp = fbp; // Include fbp parameter if present

  // Log the received payload for debugging.
  console.log('Received payload from frontend:', { 
    eventName, pageUrl, eventId, fbc_present: !!fbc, fbp_present: !!fbp,
    client_ip_address: userData.client_ip_address, client_user_agent: userData.client_user_agent,
    request_origin: requestOrigin,
    event_value: value, 
    event_currency: currency 
  });

  // Build the event payload for Facebook.
  const eventPayload = {
    event_name: eventName, 
    action_source: 'website', 
    event_source_url: pageUrl,
    user_data: userData, 
    event_id: eventId, 
    // test_event_code: 'TEST12345', // IMPORTANT: REMOVE/COMMENT OUT FOR PRODUCTION! Only for testing.
  };

  // --- FIX: Derive event_time from _fbc cookie if possible, else use current time ---
  let finalEventTime = Math.floor(Date.now() / 1000); // Default to current time in seconds

  if (fbc) { // If fbc cookie value is available from frontend payload
    const fbcParts = fbc.split('.');
    // _fbc format: fb.1.<timestamp>.<fbclid>
    // Timestamp is in seconds and located at index 2
    if (fbcParts.length >= 4 && !isNaN(parseInt(fbcParts[2]))) {
        const fbcCreationTime = parseInt(fbcParts[2]); // This is already in seconds
        const currentTimeSec = Math.floor(Date.now() / 1000);
        const oneDayAgo = currentTimeSec - 86400; // Define 1 day in seconds (24 * 60 * 60)

        // Only use fbcCreationTime if it's not in the future and not unreasonably old (e.g., more than 1 day ago)
        if (fbcCreationTime <= (currentTimeSec + 60) && fbcCreationTime >= oneDayAgo) { // Allow slight future leeway
            finalEventTime = fbcCreationTime;
        } else {
            console.warn(`WARNING: Invalid _fbc creation time (${fbcCreationTime}) for event '${eventName}'. Using current time instead.`);
        }
    } else {
        console.warn(`WARNING: Malformed _fbc cookie '${fbc}' for event '${eventName}'. Using current time for event_time.`);
    }
  }
  eventPayload.event_time = finalEventTime;
  // --- END FIX: event_time ---

  // --- FIX: Conditionally add value/currency inside custom_data and ensure value is number type ---
  eventPayload.custom_data = {
    button_name: buttonName || eventName, // Always include button name if available
    // Conditionally add value and currency inside custom_data
    ...(value !== undefined && value !== null && { // Check if value is defined and not null
      value: typeof value === 'string' ? parseFloat(value) : value, // Ensure value is a number
      currency: currency || 'BDT', // Default to BDT if currency is missing for value events
    }),
  };
  // --- END FIX: value/currency ---

  // Send event to Facebook Conversions API.
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
