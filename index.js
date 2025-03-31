const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// HighLevel Private Integration token (from your sub-account)
const HL_PRIVATE_TOKEN = process.env.HL_PRIVATE_TOKEN;
const HL_API_URL = 'https://rest.gohighlevel.com/v2';
const TEAMUP_API_URL = 'https://api.goteamup.com/v1';

// Endpoint to sync TeamUp customers to HighLevel
app.post('/sync-customers', async (req, res) => {
  const { teamUpApiKey } = req.body;

  if (!teamUpApiKey) {
    return res.status(400).json({ error: 'Missing TeamUp API key' });
  }

  try {
    // Fetch customers from TeamUp
    const teamUpResponse = await axios.get(`${TEAMUP_API_URL}/customers`, {
      headers: { Authorization: `Bearer ${teamUpApiKey}` },
    });
    const customers = teamUpResponse.data.customers;

    // Sync to HighLevel
    for (const customer of customers) {
      const hlContact = {
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone || '',
      };

      await axios.post(`${HL_API_URL}/contacts`, hlContact, {
        headers: { Authorization: `Bearer ${HL_PRIVATE_TOKEN}` },
      });
      console.log(`Synced ${customer.first_name} to HighLevel`);
    }

    res.json({ message: 'Customers synced successfully!' });
  } catch (error) {
    console.error('Error syncing customers:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to sync customers: ' + (error.response?.data?.error || error.message) });
  }
});

app.get('/', (req, res) => {
  res.send('TeamUp Gym Manager is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
