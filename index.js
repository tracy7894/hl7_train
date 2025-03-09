const hl7 = require("simple-hl7");
const moment = require("moment");

// 引入解析函式
const parseMSH = require("./parsers/parseMSH");
const parsePID = require("./parsers/parsePID");
const parseSPM = require("./parsers/parseSPM");
const parseORC = require("./parsers/parseORC");
const parseOBR = require("./parsers/parseOBR");

// 構建 ORL^O34 訊息並轉為字串
function buildORL34(orderControl, originalMessage) {
    const msh = originalMessage.header;
    const messageTime = moment().format("YYYYMMDDHHmmss");

    // 使用 simple-hl7 構建 ORL^O34 訊息
    const orlMessage = new hl7.Message(
        "MAGLUMI X3", // 發送應用 (MSH-3)
        "Lis",        // 發送設施 (MSH-4)
        msh?.fields[5]?.[0]?.value?.[0] || "UNKNOWN", // 接收應用 (MSH-5)
        msh?.fields[3]?.[0]?.value?.[0] || "UNKNOWN", // 接收設施 (MSH-6)
        messageTime,  // 日期時間 (MSH-7)
        "",           // 安全 (MSH-8)
        "ORL^O34",    // 訊息類型 (MSH-9)
        msh?.fields[10]?.[0]?.value?.[0] || "MSGID", // 訊息控制 ID (MSH-10)
        "P",          // 處理 ID (MSH-11)
        "2.5"         // 版本 ID (MSH-12)
    );

    // 設置分隔符，使用與輸入一致的鍵名
    const delimiters = msh?.delimiters || {
        fieldSeperator: '|',
        componentSeperator: '^',
        subcomponentSeperator: '&',
        repititionCharacter: '~',
        escapeCharacter: '\\',
        segmentSeperator: '\r'
    };
    orlMessage.delimiters = delimiters;
    console.log("ORL^O34 訊息分隔符 (設置後):", orlMessage.delimiters);

    // 構建 ORC 段
    const orcSegment = new hl7.Segment("ORC");
    orcSegment[1] = [orderControl]; // ORC-1: 訂單控制代碼 (OK, CR, UC)
    orlMessage.addSegment(orcSegment);

    // 序列化為字串並添加 MLLP 封包
    let orlString;
    try {
        console.log("ORL^O34 訊息分隔符 (序列化前):", orlMessage.delimiters); // 檢查序列化前的狀態
        // 強制重新賦值 delimiters，確保序列化時有效
        orlMessage.delimiters = delimiters;
        orlString = orlMessage.toString();
        console.log("ORL^O34 訊息分隔符 (序列化後):", orlMessage.delimiters); // 檢查序列化後的狀態
        console.log("ORL^O34 序列化後:", orlString);
        return `<${orlString}>`; // 添加 MLLP 封包
    } catch (toStringError) {
        console.error("ORL^O34 序列化失敗:", toStringError.message, toStringError.stack);
        return `<MSH|^~\&|MAGLUMI X3|Lis|UNKNOWN|UNKNOWN|${messageTime}||ORL^O34|MSGID|P|2.5\rORC|${orderControl}|\r>`;
    }
}

const app = hl7.tcp();

app.use((req, res, next) => {
    try {
        console.log("接收到請求，req 對象:", JSON.stringify({ socket: !!req.socket, destroyed: req.socket?.destroyed }));

        let message = req.msg;

        if (!message || typeof message.toString !== "function") {
            throw new Error("req.msg 無效，解析失敗");
        }

        // 診斷 message.header
        console.log("原始訊息 header:", message.header);

        // 使用拆分後的解析函式
        const msh = parseMSH(message);
        const pid = parsePID(message);
        const spm = parseSPM(message);
        const orc = parseORC(message);
        const obr = parseOBR(message);

        // 解析 MSH 來獲取訊息類型
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
            console.log("處理 OML^O33 訂單接受訊息");
            ackStatus = "AA";
            orlMessage = buildORL34("OK", message);
        } else if (messageType.startsWith("OML^O34") && orderControl === "CA") {
            console.log("處理 OML^O34 訂單取消訊息");
            ackStatus = "AA";
            orlMessage = buildORL34("CR", message);
        } else {
            ackStatus = "AR";
            ackText = "不支援的訊息類型或無效的訂單控制代碼";
        }

        // 構建 ACK 訊息
        const ackMessage = new hl7.Message(
            "TEST-SERVER",
            "HL7APP",
            msh?.[2]?.components?.[0]?.[0]?.value?.[0] || "UNKNOWN", // MSH-3
            msh?.[4]?.components?.[0]?.[0]?.value?.[0] || "UNKNOWN", // MSH-5
            moment().format("YYYYMMDDHHmmss"),
            "",
            "ACK",
            msh?.[7]?.components?.[0]?.[0]?.value?.[0] || "MSGID", // MSH-10
            "P",
            msh?.[9]?.components?.[0]?.[0]?.value?.[0] || "2.5" // MSH-12
        );

        // 設置分隔符，使用與輸入一致的鍵名
        const delimiters = message.header?.delimiters || {
            fieldSeperator: '|',
            componentSeperator: '^',
            subcomponentSeperator: '&',
            repititionCharacter: '~',
            escapeCharacter: '\\',
            segmentSeperator: '\r'
        };
        ackMessage.delimiters = delimiters;
        console.log("ACK 訊息分隔符 (設置後):", ackMessage.delimiters);
        console.log("MSH delimiters:", msh?.delimiters);  // 檢查 delimiters 是否存在

        const msa = new hl7.Segment("MSA");
        msa[1] = ackStatus;
        msa[2] = msh?.[7]?.components?.[0]?.[0]?.value?.[0] || "MSGID";
        msa[3] = ackText;
        ackMessage.addSegment(msa);

        // 序列化 ACK 訊息
        let ackString;
        try {
            console.log("ACK 訊息分隔符 (序列化前):", ackMessage.delimiters); // 檢查序列化前的狀態
            // 強制重新賦值 delimiters，確保序列化時有效
            ackMessage.delimiters = delimiters;
            ackString = ackMessage.toString();
            console.log("ACK 訊息分隔符 (序列化後):", ackMessage.delimiters); // 檢查序列化後的狀態
            console.log("發送 ACK 訊息 (序列化後):", ackString);
        } catch (toStringError) {
            console.error("ACK 訊息序列化失敗:", toStringError.message, toStringError.stack);
            ackString = `MSH|^~\&|ERROR|SERVER|FAIL|NORESPONSE|${moment().format("YYYYMMDDHHmmss")}||ACK|||2.5\rMSA|AE|UNKNOWN|ACK 訊息序列化失敗: ${toStringError.message}\r`;
        }

        // 將 ACK 和 ORL 訊息一起發送
        const response = orlMessage ? `${orlMessage}\r${ackString}` : ackString;
        res.end(response);

    } catch (error) {
        console.error("HL7 訊息解析錯誤:", error);
        res.end(`錯誤: ${error.message}`);
    }
});

const PORT = 8080;
app.start(PORT)
    console.log(`HL7 伺服器已啟動，監聽端口 ${PORT}`);
