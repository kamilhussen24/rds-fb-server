// api/track-event.js
import { URL } from 'url';

export default async function handler(req, res) {
  // Define allowed origins for CORS
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
  const requestOrigin = req.headers.origin; // Get the origin from the request headers

  let isOriginAllowed = false;
  // Check if the request origin is in the allowed list
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    isOriginAllowed = true;
  } else if (allowedOrigins.length === 0) {
    // WARNING: If ALLOWED_ORIGINS is not set, we allow all for flexibility.
    // However, this is INSECURE for production unless you handle authorization otherwise.
    console.warn('WARNING: ALLOWED_ORIGINS environment variable is not set. Allowing all origins for CORS. Please configure ALLOWED_ORIGINS for production security.');
    isOriginAllowed = true; // Allow all if not configured (development/testing default)
  }

  // --- Common CORS Headers Setup ---
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', 86400); // Cache preflight response for 24 hours
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // Required when client uses `credentials: 'include'`

  // Set Access-Control-Allow-Origin header based on whether the origin is allowed.
  // This header must be set to the exact origin for allowed requests, or omitted/set to a non-matching origin for blocked ones.
  if (isOriginAllowed && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  } else if (requestOrigin) { // If origin exists but is NOT allowed, set a non-matching ACAO
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || 'null'); // Set to a dummy or first allowed origin to fail browser check
  }
  // If requestOrigin is undefined (e.g., direct server-to-server call or no-origin request), ACAO is not strictly needed by browser.

  // --- Handle Preflight (OPTIONS) Requests ---
  if (req.method === 'OPTIONS') {
    console.log(`Received OPTIONS preflight request from origin: ${requestOrigin}. Allowed: ${isOriginAllowed}.`);
    
    if (!isOriginAllowed && allowedOrigins.length > 0) {
      // If preflight request is from an unauthorized origin AND origins are configured,
      // return 403 Forbidden. This explicitly tells the browser the origin is not allowed.
      console.warn(`SECURITY WARNING: Preflight request from unauthorized origin: ${requestOrigin}. Returning 403 Forbidden.`);
      return res.status(403).json({ success: false, message: 'Forbidden: Request origin not allowed by CORS policy.' });
    }
    // If origin is allowed (or all origins are allowed), return 200 OK for preflight.
    return res.status(200).end(); 
  }

  // --- Handle Actual (POST) Requests ---
  // Ensure it's a POST request for event processing
  if (req.method !== 'POST') {
    console.error(`ERROR: Method Not Allowed. Received ${req.method} request from ${requestOrigin}.`);
    return res.status(405).json({ success: false, message: 'Method Not Allowed. Only POST requests are allowed for event processing.' });
  }

  // If the origin is not allowed for an actual POST request, block it
  if (!isOriginAllowed && allowedOrigins.length > 0) {
    console.warn(`SECURITY WARNING: POST request from unauthorized origin: ${requestOrigin}. Returning 403 Forbidden.`);
    return res.status(403).json({ success: false, message: 'Forbidden: Request origin not allowed by CORS policy.' });
  }

  // --- Process Authorized Request ---
  // Get Facebook Pixel ID and Access Token from Vercel Environment Variables
  const PIXEL_ID = process.env.FACEBOOK_PIXEL_ID;
  const ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('ERROR: Facebook credentials not configured. Check Vercel Environment Variables (FACEBOOK_PIXEL_ID, FACEBOOK_ACCESS_TOKEN).');
    return res.status(500).json({ success: false, message: 'Facebook credentials not configured.' });
  }

  // Receive data sent from the frontend
  const { 
    eventName, 
    buttonName, 
    pageUrl, 
    fbc, 
    fbp, 
    eventId 
  } = req.body;

  // Collect basic user data for Facebook
  const clientIpAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress; 
  const clientUserAgent = req.headers['user-agent']; 

  const userData = {
    client_ip_address: clientIpAddress, 
    client_user_agent: clientUserAgent, 
  };

  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  // Log received payload for debugging in Vercel logs - this will now show for allowed origins
  console.log('Received payload from frontend:', { 
    eventName, 
    pageUrl, 
    eventId, 
    fbc_present: !!fbc, 
    fbp_present: !!fbp,
    client_ip_address: clientIpAddress, 
    client_user_agent: clientUserAgent,
    request_origin: requestOrigin 
  });

  const eventPayload = {
    event_name: eventName, 
    event_time: Math.floor(Date.now() / 1000), 
    action_source: 'website',
    event_source_url: pageUrl,
    user_data: userData, 
    event_id: eventId, 
  // test_event_code: 'TEST12345', 
  };

  if (buttonName) {
    eventPayload.custom_data = {
      button_name: buttonName, 
    };
  }

  try {
    console.log(`Attempting to send event '${eventName}' to Facebook.`);
    const facebookResponse = await fetch(`https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [eventPayload],
      }),
    });

    const fbData = await facebookResponse.json();
    console.log('Facebook API Raw Response:', fbData); 

    if (fbData.error) {
        console.error('ERROR: Facebook API reported an error:', fbData.error);
        return res.status(500).json({ success: false, message: 'Facebook API Error', error: fbData.error });
    }
    
    if (fbData.events_received && fbData.events_received > 0) {
        console.log(`SUCCESS: Event '${eventName}' successfully sent to Facebook. Events received: ${fbData.events_received}`);
    } else {
        console.warn(`WARNING: Event '${eventName}' sent to Facebook, but no events received confirmation. Facebook Response:`, fbData);
    }

    res.status(200).json({ success: true, message: `Event '${eventName}' sent to Facebook`, facebookResponse: fbData });

  } catch (error) {
    console.error('ERROR: Failed to send event to Facebook due to network or unexpected error:', error);
    res.status(500).json({ success: false, message: 'Failed to send event to Facebook', error: error.message });
  }
}
