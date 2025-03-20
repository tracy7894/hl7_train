const hl7 = require("simple-hl7");
const moment = require("moment");
const net = require("net");

// 引入解析函式
const parseMSH = require("./parsers/parseMSH");
const parsePID = require("./parsers/parsePID");
const parseSPM = require("./parsers/parseSPM");
const parseORC = require("./parsers/parseORC");
const parseOBR = require("./parsers/parseOBR");

// 手動構建 ORL^O34 訊息
function buildORL34Manual(orderControl, msh) {
    const time = moment().format("YYYYMMDDHHmmss");

    const delimiters = {
        field: "|",
        component: "^",
        subcomponent: "&",
        repetition: "~",
        escape: "\\",
        segment: "\r"
    };

    const MSH = [
        "MSH",
        "^~\\&", // 分隔符
        msh?.[2]?.components ? msh[2].components[0] : [], // 發送應用
        msh?.[0]?.components ? msh[0].components[0] : [], // 發送設施
        msh?.[5]?.components ? msh[5].components[0] : [], // 接收應用
        msh?.[3]?.components ? msh[3].components[0] : [], // 接收設施
        time, // 時間
        "", // 安全
        "ORL^O34", // 訊息類型
        msh?.[10]?.components ? msh[10].components[0] : [], // 訊息控制 ID
        "P", // 處理 ID
        "2.5" // 版本 ID
    ].join(delimiters.field);

    const ORC = [
        "ORC",
        orderControl // 訂單控制碼 (如 OK / CR)
    ].join(delimiters.field);

    const orlMessage = `\x0b${MSH}\n${ORC}\n\x1c\x0d`;
    console.log("生成的 ORL^O34 訊息:");
    console.log(orlMessage);
    return orlMessage;
}

// 手動構建 ACK 訊息
function buildACKManual(ackStatus, ackText, msh) {
    const time = moment().format("YYYYMMDDHHmmss");

    const delimiters = {
        field: "|",
        component: "^",
        subcomponent: "&",
        repetition: "~",
        escape: "\\",
        segment: "\r"
    };

    const MSH = [
        "MSH",
        "^~\\&", // 分隔符
        "TEST-SERVER", // 發送應用 (MSH-3)
        "HL7APP",      // 發送設施 (MSH-4)
        msh?.[2]?.components?.[0]?.[0]?.value?.[0] || "UNKNOWN", // 接收應用 (MSH-3 從原始訊息獲取)
        msh?.[4]?.components?.[0]?.[0]?.value?.[0] || "UNKNOWN", // 接收設施 (MSH-5 從原始訊息獲取)
        time,          // 日期時間 (MSH-7)
        "",            // 安全 (MSH-8)
        "ACK",         // 訊息類型 (MSH-9)
        msh?.[7]?.components?.[0]?.[0]?.value?.[0] || "MSGID",   // 訊息控制 ID (MSH-10 從原始訊息獲取)
        "P",           // 處理 ID (MSH-11)
        "2.5"          // 版本 ID (MSH-12)
    ].join(delimiters.field);

    const MSA = [
        "MSA",
        ackStatus,     // 確認狀態 (AA 或 AR)
        msh?.[7]?.components?.[0]?.[0]?.value?.[0] || "MSGID",   // 訊息控制 ID (與 MSH-10 一致)
        ackText        // 確認文本
    ].join(delimiters.field);

    const ackMessage = `\x0b${MSH}\n${MSA}\n\x1c\x0d`;
    console.log("生成的 ACK 訊息:");
    console.log(ackMessage);
    return ackMessage;
}

// 處理 HL7 訊息的核心邏輯
async function processHL7Message(message) {
    const msh = parseMSH(message);
    const pid = parsePID(message);
    const spm = parseSPM(message);
    const orc = parseORC(message);
    const obr = parseOBR(message);

    if (!pid) console.log("找不到 PID 段");
    if (!spm) console.log("找不到 SPM 段");
    if (!orc) console.log("找不到 ORC 段");
    if (!obr) console.log("找不到 OBR 段");

    const messageTypeRaw = msh?.[6]?.components ? msh[6].components[0] : [];
    const messageType = Array.isArray(messageTypeRaw) && messageTypeRaw.length > 0
        ? messageTypeRaw.map(comp => comp.value[0]).join("^")
        : "未知";
    const orderControl = orc?.[0]?.components?.[0] || "未知";

    console.log(`訊息類型: ${messageType}`);
    console.log(`訂單控制: ${orderControl}`);

    let ackStatus = "AA";
    let ackText = "訊息處理成功";
    let orlMessage = "";

    if (messageType == "OML^O33" && orderControl == "NW") {
        console.log("=處理 OML^O33 訂單接受訊息=");
        ackStatus = "AA";
        orlMessage = buildORL34Manual("OK", msh);
    } else if (messageType == "OML^O33" && orderControl == "CA") {
        console.log("=處理 OML^O33 訂單取消訊息=");
        ackStatus = "AA";
        orlMessage = buildORL34Manual("CR", msh);
    } else if (messageType == "OML^O33" && orderControl == "DC") {
        console.log("=Discontinue order OML^O33=");
        ackStatus = "AA";
        orlMessage = buildORL34Manual("OK", msh);
    } else {
        ackStatus = "AR";
        ackText = "不支援的訊息類型或無效的訂單控制代碼";
    }

    const ackMessage = buildACKManual(ackStatus, ackText, msh);
    return orlMessage ? `${orlMessage}${ackMessage}` : ackMessage;
}

// 創建一個 TCP 伺服器，同時處理 HTTP 和 HL7 流量
const PORT = 8080;
const server = net.createServer((socket) => {
    console.log("新連接建立:", socket.remoteAddress, socket.remotePort);

    let buffer = "";

    socket.on("data", async (data) => {
        buffer += data.toString();

        // 檢查是否為 HTTP 請求
        if (buffer.startsWith("POST /hl7 HTTP/1.1")) {
            // 等待完整 HTTP 請求
            if (!buffer.includes("\r\n\r\n")) {
                return; // 繼續等待更多數據
            }

            try {
                // 解析 HTTP 請求
                const [headerPart, bodyPart] = buffer.split("\r\n\r\n");
                const headers = headerPart.split("\r\n");
                const contentLength = headers
                    .find((h) => h.toLowerCase().startsWith("content-length:"))
                    ?.split(":")[1]
                    ?.trim();

                if (!contentLength || bodyPart.length < parseInt(contentLength)) {
                    return; // 等待更多數據
                }

                const rawMessage = bodyPart.slice(0, parseInt(contentLength));
                console.log("接收到的 HTTP HL7 原始訊息:", rawMessage);

                // 將所有換行符（\n 或 \r\n）替換為 HL7 標準的 \r
                const cleanedMessage = rawMessage
                    .replace(/\r\n/g, "\r")// 替換 Windows 風格換行
                    // .replace(/\n/g, "\r")   // 替換 Unix 風格換行
                    // .replace(/[\x0b\x1c\x0d]/g, "") // 移除 MLLP 封包
                    // .trim();

                console.log("處理後的 HTTP HL7 訊息:", cleanedMessage);

                // 使用 simple-hl7 解析訊息
                const parser = new hl7.Parser();
                const message = parser.parse(cleanedMessage);

                const response = await processHL7Message(message);

                // 構建 HTTP 回應
                const httpResponse = [
                    "HTTP/1.1 200 OK",
                    "Content-Type: text/plain",
                    `Content-Length: ${Buffer.byteLength(response)}`,
                    "",
                    response
                ].join("\r\n");

                socket.write(httpResponse);
                socket.end();
            } catch (error) {
                console.error("HTTP HL7 訊息解析錯誤:", error);
                const msh = null;
                const orlMessage = buildORL34Manual("UA", msh);
                const ackMessage = buildACKManual("AR", `錯誤: ${error.message}`, msh);
                const response = orlMessage ? `${orlMessage}${ackMessage}` : ackMessage;

                const httpResponse = [
                    "HTTP/1.1 400 Bad Request",
                    "Content-Type: text/plain",
                    `Content-Length: ${Buffer.byteLength(response)}`,
                    "",
                    response
                ].join("\r\n");

                socket.write(httpResponse);
                socket.end();
            }
        } else if (buffer.startsWith("\x0b")) {
            // 處理 HL7 TCP 流量（MLLP 協議）
            const endIndex = buffer.indexOf("\x1c\x0d");
            if (endIndex === -1) {
                return; // 等待更多數據
            }

            try {
                const rawMessage = buffer.slice(1, endIndex).trim();
                console.log("接收到的 TCP HL7 訊息:", rawMessage);

                const parser = new hl7.Parser();
                const message = parser.parse(rawMessage);

                const response = await processHL7Message(message);
                socket.write(response);
                socket.end();
            } catch (error) {
                console.error("TCP HL7 訊息解析錯誤:", error);
                const msh = null;
                const orlMessage = buildORL34Manual("UA", msh);
                const ackMessage = buildACKManual("AR", `錯誤: ${error.message}`, msh);
                const response = orlMessage ? `${orlMessage}${ackMessage}` : ackMessage;

                socket.write(response);
                socket.end();
            }
        } else {
            // 未知協議
            socket.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            socket.end();
        }
    });

    socket.on("error", (err) => {
        console.error("Socket 錯誤:", err);
    });

    socket.on("end", () => {
        console.log("連接關閉:", socket.remoteAddress, socket.remotePort);
    });
});

// 啟動伺服器
server.listen(PORT, () => {
    console.log(`HL7 伺服器已啟動，監聽端口 ${PORT}（支持 TCP 和 HTTP）`);
});