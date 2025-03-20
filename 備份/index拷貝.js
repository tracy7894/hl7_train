const hl7 = require("simple-hl7");
const moment = require("moment");
const net = require("net");
// 引入解析函式
const parseMSH = require("./parsers/parseMSH");
const parsePID = require("./parsers/parsePID");
const parseSPM = require("./parsers/parseSPM");
const parseORC = require("./parsers/parseORC");
const parseOBR = require("./parsers/parseOBR"); 
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

    // 構建 MSH 段
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

    // 構建 MSA 段
    const MSA = [
        "MSA",
        ackStatus,     // 確認狀態 (AA 或 AR)
        msh?.[7]?.components?.[0]?.[0]?.value?.[0] || "MSGID",   // 訊息控制 ID (與 MSH-10 一致)
        ackText        // 確認文本
    ].join(delimiters.field);

    console.log('ACK MSH:', MSH);
    console.log('ACK MSA:', MSA);

    // 構建最終訊息並添加 MLLP 封包
    const ackMessage = `\x0b${MSH}${delimiters.segment}${MSA}${delimiters.segment}\x1c\x0d`;
    console.log("生成的 ACK 訊息:");
    console.log(ackMessage);
    return ackMessage;
}
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
        msh?.[2]?.components ? msh[2].components[0] : [],// MAGLUMI X3", 發送應用 2        
        msh?.[0]?.components ? msh[0].components[0] : [],//"Lis",   發送設施 0
        msh?.[5]?.components ? msh[5].components[0] : [],// 接收應用
        msh?.[3]?.components ? msh[3].components[0] : [], // 接收設施
        time, // 時間
        "", // 安全
        "ORL^O34", // 訊息類型

        msh?.[10]?.components ? msh[10].components[0] : [],// 訊息控制 ID
        "P", // 處理 ID
        "2.5" // 版本 ID
    ].join(delimiters.field);

    const ORC = [
        "ORC",
        orderControl // 訂單控制碼 (如 OK / CR)
    ].join(delimiters.field);
    console.log('MSH:' + MSH)
    console.log('ORC:' + ORC)
    // MLLP 封包格式：<HL7 message>
    // const debugMessage = `${MSH}${delimiters.segment.replace(/\r/g, "\n")}${ORC}${delimiters.segment.replace(/\r/g, "\n")}`;
     console.log('debugMessage');
    console.log(`\x0b${MSH}\n${ORC}\n\x1c\x0d`)
    return `\x0b${MSH}\n${ORC}\n\x1c\x0d`
}

const app = hl7.tcp();

app.use(async (req, res, next) => {
    try {
       // console.log("接收到請求，req 對象:", JSON.stringify({ socket: !!req.socket, destroyed: req.socket?.destroyed }));

        let message = req.msg;

        if (!message || typeof message.toString !== "function") {
            throw new Error("req.msg 無效，解析失敗");
        }
        // 診斷 message.header
      //  console.log("原始訊息 header:", message.header);

        // 使用拆分後的解析函式

        const msh = parseMSH(message);
        const pid = parsePID(message);
        const spm = parseSPM(message);
        const orc = parseORC(message);
        const obr = parseOBR(message);
        // if(msh==null||pid==null||spm==nell||orc==null||obr==null){
        //     buildORL34Manual("UA", msh);
        //     console.log("=處理 OML^O33 訂單接受訊息錯誤=")
        // }
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
            console.log("=處理 OML^O33 訂單接受訊息=");
            ackStatus = "AA";
            orlMessage = buildORL34Manual("OK", msh);
        }
        else if (messageType == "OML^O33" && orderControl == "CA") {
            console.log("=處理 OML^O33 訂單取消訊息=");
            ackStatus = "AA";
            orlMessage = buildORL34Manual("CR", msh);
        }
        else if (messageType == "OML^O33" && orderControl == "DC") {
            console.log("=Discontinue order OML^33=");
            ackStatus = "AA";
            orlMessage = buildORL34Manual("OK", msh);
        } else {
            ackStatus = "AR";
            ackText = "不支援的訊息類型或無效的訂單控制代碼";
        }
        msh?.fields?.[10]?.[0]?.value?.[0] || "MSGID" // 訊息控制 ID
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
        const msa = new hl7.Segment("MSA");
        msa[1] = ackStatus;
        msa[2] = msh?.[7]?.components?.[0]?.[0]?.value?.[0] || "MSGID";
        msa[3] = ackText;
        ackMessage.addSegment(msa);


        // 將 ACK 和 ORL 訊息一起發送
        //   const response = orlMessage ? `${orlMessage}\r${ackString}` : ackString;
        // console.log(orlMessage);
        console.log("生成的 ORL^O34 訊息:");
        console.log(orlMessage.toString())
        const response = orlMessage;
        res.end(response);

    } catch (error) {
       // console.error("HL7 訊息解析錯誤:", error);
        msh=null
        buildORL34Manual("UA", msh);
        console.log("=處理 OML^O33 訂單無法接受訊息=")
        res.end(`錯誤: ${error.message}`);
    }
});

const PORT = 8080;
app.start(PORT)
console.log(`HL7 伺服器已啟動，監聽端口 ${PORT}`);
