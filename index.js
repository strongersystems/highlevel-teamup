const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const dns = require('dns').promises;
const storage = require('node-persist');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public')); // Serve static files from the public folder

const HL_PRIVATE_TOKEN = process.env.HL_PRIVATE_TOKEN;
const HL_API_URL = 'https://rest.gohighlevel.com/v2';
const TEAMUP_API_URL = 'https://goteamup.com/api/business/v1';
const TEAMUP_AUTH_URL = 'https://goteamup.com/api/auth/authorize';
const TEAMUP_TOKEN_URL = 'https://goteamup.com/api/auth/access_token';
const TEAMUP_CLIENT_ID = process.env.TEAMUP_CLIENT_ID;
const TEAMUP_CLIENT_SECRET = process.env.TEAMUP_CLIENT_SECRET;
const TEAMUP_REDIRECT_URI = 'https://stronger-teamup.onrender.com/teamup/callback';
const TEAMUP_BUSINESS_ID = process.env.TEAMUP_BUSINESS_ID;
const TEAMUP_MEMBERSHIP_ID = process.env.TEAMUP_MEMBERSHIP_ID; // Added Membership ID from environment variable

// Configure axios-retry
axiosRetry(axios, {
  retries: 3, // Retry 3 times
  retryDelay: (retryCount) => {
    return retryCount * 1000; // Exponential backoff: 1s, 2s, 3s
  },
  retryCondition: (error) => {
    // Retry on network errors (e.g., ENOTFOUND) or 5xx status codes
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || (error.response && error.response.status >= 500);
  }
});

// Initialize node-persist storage
(async () => {
  await storage.init({ dir: 'storage' }); // Store data in a 'storage' directory
})();

// Store states in memory (for demo purposes; use a database in production)
const states = {};

// Debug route to test DNS resolution
app.get('/debug/dns', async (req, res) => {
  try {
    const addresses = await dns.lookup('goteamup.com');
    res.json({ message: 'DNS resolution successful', addresses });
  } catch (error) {
    res.status(500).json({ error: 'DNS resolution failed', details: error.message });
  }
});

// Route to initiate TeamUp OAuth flow
app.get('/teamup/auth', (req, res) => {
  const state = Math.random().toString(36).substring(2);
  states['user'] = state; // Replace 'user' with a user identifier in production

  const authUrl = `${TEAMUP_AUTH_URL}?response_type=code&client_id=${TEAMUP_CLIENT_ID}&redirect_uri=${TEAMUP_REDIRECT_URI}&scope=read_write&state=${state}`;
  console.log('Redirecting to TeamUp Auth URL:', authUrl);
  res.redirect(authUrl);
});

// Route to handle TeamUp OAuth callback
app.get('/teamup/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  console.log('TeamUp Authorization Code:', code);
  console.log('TeamUp State:', state);

  const expectedState = states['user'];
  if (!state || state !== expectedState) {
    console.error('Invalid state parameter in TeamUp callback');
    return res.status(400).send('Authorization failed: Invalid state parameter');
  }
  delete states['user'];

  if (!code) {
    console.error('No authorization code provided in TeamUp callback');
    return res.status(400).send('Authorization failed: No code provided');
  }

  try {
    const formData = new URLSearchParams();
    formData.append('grant_type', 'authorization_code');
    formData.append('client_id', TEAMUP_CLIENT_ID);
    formData.append('client_secret', TEAMUP_CLIENT_SECRET);
    formData.append('redirect_uri', TEAMUP_REDIRECT_URI);
    formData.append('code', code);

    const response = await axios.post(TEAMUP_TOKEN_URL, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = response.data.access_token;
    console.log('TeamUp Access Token:', accessToken);

    // Store the access token persistently
    await storage.setItem('teamup_access_token_user', accessToken); // Replace 'user' with a user identifier in production

    res.send('TeamUp authorization successful! You can now proceed with the workflow.');
  } catch (error) {
    console.error('Error exchanging code for TeamUp token:', error.response?.data || error.message);
    res.status(500).send('TeamUp authorization failed: ' + (error.response?.data?.error || error.message));
  }
});

// Endpoint to create a customer in TeamUp (called by HighLevel workflow)
app.post('/create-teamup-customer', async (req, res) => {
  const { firstName, lastName, email, userId } = req.body;

  if (!firstName || !lastName || !email || !userId) {
    return res.status(400).json({ error: 'Missing required fields: firstName, lastName, email, or userId' });
  }

  const teamUpAccessToken = await storage.getItem(`teamup_access_token_${userId}`);
  if (!teamUpAccessToken) {
    return res.status(400).json({ error: 'Missing TeamUp access token. Please authorize TeamUp first.' });
  }

  if (!TEAMUP_BUSINESS_ID) {
    return res.status(400).json({ error: 'Missing TeamUp Business ID. Please set TEAMUP_BUSINESS_ID environment variable.' });
  }

  try {
    const response = await axios.post(`${TEAMUP_API_URL}/customers`, {
      first_name: firstName,
      last_name: lastName,
      email: email
    }, {
      headers: {
        Authorization: `Bearer ${teamUpAccessToken}`,
        'Content-Type': 'application/json',
        'Business-ID': TEAMUP_BUSINESS_ID
      }
    });

    console.log(`Created TeamUp customer: ${firstName} ${lastName} (${email})`);
    res.json({ message: 'Customer created in TeamUp successfully', customer: response.data });
  } catch (error) {
    console.error('Error creating TeamUp customer:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create customer in TeamUp: ' + (error.response?.data?.error || error.message) });
  }
});

// Endpoint to add a customer membership in TeamUp (called by HighLevel workflow)
app.post('/add-teamup-membership', async (req, res) => {
  const { email, userId } = req.body;

  if (!email || !userId) {
    return res.status(400).json({ error: 'Missing required fields: email or userId' });
  }

  const teamUpAccessToken = await storage.getItem(`teamup_access_token_${userId}`);
  if (!teamUpAccessToken) {
    return res.status(400).json({ error: 'Missing TeamUp access token. Please authorize TeamUp first.' });
  }

  if (!TEAMUP_BUSINESS_ID) {
    return res.status(400).json({ error: 'Missing TeamUp Business ID. Please set TEAMUP_BUSINESS_ID environment variable.' });
  }

  if (!TEAMUP_MEMBERSHIP_ID) {
    return res.status(400).json({ error: 'Missing TeamUp Membership ID. Please set TEAMUP_MEMBERSHIP_ID environment variable.' });
  }

  try {
    // Step 1: Find the customer by email to get the customer_id
    const customerResponse = await axios.get(`${TEAMUP_API_URL}/customers?email=${encodeURIComponent(email)}`, {
      headers: {
        Authorization: `Bearer ${teamUpAccessToken}`,
        'Business-ID': TEAMUP_BUSINESS_ID
      }
    });

    console.log('TeamUp Customer Response:', customerResponse.data);

    const customers = customerResponse.data;
    if (!customers || customers.length === 0) {
      return res.status(404).json({ error: 'Customer not found in TeamUp' });
    }

    const customerId = customers[0].id;

    // Step 2: Create the customer membership
    const membershipResponse = await axios.post(`${TEAMUP_API_URL}/customer-memberships`, {
      customer_id: customerId,
      membership_id: TEAMUP_MEMBERSHIP_ID,
      start_date: new Date().toISOString().split('T')[0] // Use today's date in YYYY-MM-DD format
    }, {
      headers: {
        Authorization: `Bearer ${teamUpAccessToken}`,
        'Content-Type': 'application/json',
        'Business-ID': TEAMUP_BUSINESS_ID
      }
    });

    console.log(`Added TeamUp customer membership for ${email} (Customer ID: ${customerId})`);
    res.json({ message: 'Customer membership added in TeamUp successfully', membership: membershipResponse.data });
  } catch (error) {
    console.error('Error adding TeamUp customer membership:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to add customer membership in TeamUp: ' + (error.response?.data?.error || error.message) });
  }
});

// Webhook endpoint to receive TeamUp events
app.post('/teamup/webhook', async (req, res) => {
  console.log('Received TeamUp webhook:', req.body);

  try {
    const event = req.body;

    if (event.event === 'customer.created') {
      const customer = event.data;
      const hlContact = {
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone || '',
      };

      await axios.post(`${HL_API_URL}/contacts`, hlContact, {
        headers: { Authorization: `Bearer ${HL_PRIVATE_TOKEN}` }
      });
      console.log(`Synced new customer ${customer.first_name} to HighLevel via webhook`);
    }

    res.status(200).json({ message: 'Webhook received successfully' });
  } catch (error) {
    console.error('Error processing TeamUp webhook:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

app.get('/', (req, res) => {
  res.send('TeamUp Gym Manager is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
