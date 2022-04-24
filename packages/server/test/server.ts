import express from 'express';
import { createServer } from 'http';
import { attach } from '../src';

const app = express();
const server = createServer(app);

app.get('/', (req, res) => {
  res.status(200).send('Hello World!');
});

attach(server, {
  cors: {
    origin: '*',
  },
});

server.listen(2000);
