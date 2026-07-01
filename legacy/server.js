import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';

const db = new Database('database.db');

const app = express();

app.use(cors());
app.use(express.json());

function validateId(id) {
  if (typeof id !== 'number') {
    return { valid: false, messageObj: { message: 'Client ID must be a number.' } };
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) {
    return { valid: false, messageObj: { message: 'Client not found.' } };
  }
  return { valid: true, messageObj: {} };
}

app.get('/api/v1/clients', (req, res) => {
  const clients = db.prepare('SELECT * FROM clients').all();
  return res.status(200).send(clients);
});

app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    return res.status(400).send(messageObj);
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  return res.status(200).send(client);
});

app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    return res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  let clients = db.prepare('SELECT * FROM clients').all();
  const client = clients.find(client => client.id === id);

  // Update status if provided
  if (status) {
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        message: 'Invalid status provided.',
        long_message: 'Status must be one of [backlog, in-progress, complete].'
      });
    }

    db.prepare('UPDATE clients SET status = ? WHERE id = ?').run(status, id);

    // Simulate email notification
    if (status === 'complete') {
      console.log(`📬 Email notification: Task "${client.name}" marked as COMPLETE!`);
    }
  }

  // TODO: Handle priority updates if needed later

  clients = db.prepare('SELECT * FROM clients').all();
  return res.status(200).send(clients);
});

app.listen(3001, () => {
  console.log('Server running on http://localhost:3001');
});