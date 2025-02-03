const express = require("express");
const bodyParser = require("body-parser");
const net = require("net");

const HTTP_PORT = 3000;  // Postman
const MLLP_PORT = 5000;  // HAPI
const MLLP_HOST = "127.0.0.1";

const app = express();
app.use(bodyParser.text({ type: "application/hl7-v2" }));


app.post("/", (req, res) => {
    console.log("HL7 訊息：\n" + req.body);

    try {
        const hl7Message = req.body.replace(/\r\n/g, "\r").split("\r");
        const segments = ["MSH", "EVN", "PID", "NK1", "PV1", "IN1"].map(seg =>
            hl7Message.find(line => line.startsWith(seg))
        ).filter(Boolean);

        console.log("\n解析 HL7 訊息");
        segments.forEach(line => console.log(line));

        const originalMessageId = segments[0]?.split("|")[9] || "UNKNOWN";
        const ackMessage = `MSH|^~\\&|SERVER|NODE|HAPI|CLIENT|${Date.now()}||ACK^A01|${originalMessageId}|P|2.3\rMSA|AA|${originalMessageId}\r`;

        console.log("\n發送 ACK 訊息：\n" + ackMessage);
        res.set("Content-Type", "application/hl7-v2").send(ackMessage);
    } catch (error) {
        console.error("錯誤:", error);
        res.status(500).send("ERROR");
    }
});

//hapi
const { MLLPServer } = require("mllp-node");
const hl7 = require("hl7");

const hl7Server = new MLLPServer(MLLP_PORT, MLLP_PORT);

hl7Server.on("message", (data, callback) => {

    // console.log("HL7 訊息：\n" + data.toString());
    try {
        // const hl7Message = hl7.parse(data.toString());

        // console.log(" 解析 HL7 訊息:");
        // console.log(hl7Message);

        // 取得原始訊息的Message ID
        //const originalMessageId = hl7Message.get("MSH.10");

        // ACK 訊息
        const ackMessage = `MSH|^~\\&|NODE|SERVER|HAPI|CLIENT|${new Date().toISOString().replace(/[-T:]/g, "")}||ACK^A01|${originalMessageId}|P|2.3\rMSA|AA|${originalMessageId}\r`;

        // 回傳 ACK 訊息
        callback(ackMessage);
        console.log("已回覆 ACK 訊息");
    } catch (error) {
        console.error("處理 HL7 訊息時錯誤:", error);

        callback(`MSH|^~\\&|NODE|SERVER|HAPI|CLIENT|${new Date().toISOString().replace(/[-T:]/g, "")}||ACK^A01|${new Date().getTime()}|P|2.3\rMSA|AE|${new Date().getTime()}\r`);
    }
});

hl7Server.on("error", (err) => {
    console.error("伺服器錯誤:", err);
});

app.listen(HTTP_PORT, () => {
    console.log(`Express 伺服器啟動：http://127.0.0.1:${HTTP_PORT}`);
});


