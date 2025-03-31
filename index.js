const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const CLIENT_ID = process.env.HL_CLIENT_ID;
const CLIENT_SECRET = process.env.HL_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/oauth/callback';
const HL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/authorize';
const HL_TOKEN_URL = 'https://rest.gohighlevel.com/v2/oauth/token';

app.get('/auth', (req, res) => {
  const authUrl = `${HL_AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=contacts.write%20workflows.readonly`;
  console.log('Redirecting to HighLevel Auth URL:', authUrl); // Log the auth URL
  res.redirect(authUrl);
});

// Workaround for malformed redirect URL
app.get('/oauth/callback&scope=*', (req, res) => {
  console.log('Handling malformed redirect URL:', req.originalUrl);
  // Redirect to the correct /oauth/callback route
  res.redirect('/oauth/callback');
});

app.get('/oauth/callback', async (req, res) => {
  console.log('Full Callback URL:', req.originalUrl); // Log the full URL
  const code = req.query.code;
  console.log('Authorization Code:', code); // Log the code
  console.log('Client ID:', CLIENT_ID); // Log the client_id
  console.log('Client Secret:', CLIENT_SECRET); // Log the client_secret
  console.log('Redirect URI:', REDIRECT_URI); // Log the redirect_uri

  if (!code) {
    console.error('No authorization code provided in callback');
    return res.status(400).send('Authorization failed: No code provided');
  }

  try {
    const response = await axios.post(HL_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code: code,
    });
    const accessToken = response.data.access_token;
    console.log('Access Token:', accessToken);
    res.send('Authorization successful! Access Token: ' + accessToken);
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error.message);
    res.status(500).send('Authorization failed: ' + (error.response?.data?.error || error.message));
  }
});

app.get('/', (req, res) => {
  res.send('TeamUp Gym Manager is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
