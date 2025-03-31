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
  const authUrl = `${HL_AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=contacts%20workflows`;
  res.redirect(authUrl);
});

app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
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
    res.status(500).send('Authorization failed.');
  }
});

app.get('/', (req, res) => {
  res.send('TeamUp Gym Manager is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
