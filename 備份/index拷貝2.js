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

   // console.log('ORL MSH:', MSH);
   // console.log('ORL ORC:', ORC);

    // MLLP 封包格式：<HL7 message>
    const orlMessage = `\x0b${MSH}\n${ORC}\n\x1c\x0d`
    console.log("生成的 ORL^O34 訊息:");
    console.log(orlMessage);
    return orlMessage;
    //console.log(`\x0b${MSH}\n${ORC}\n\x1c\x0d`)
  //  return `\x0b${MSH}\n${ORC}\n\x1c\x0d`
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

   // console.log('ACK MSH:', MSH);
   // console.log('ACK MSA:', MSA);
  //  const orlMessage = `\x0b${MSH}\n${ORC}\n\x1c\x0d`
    const ackMessage = `\x0b${MSH}\n${MSA}\n\x1c\x0d`;
    console.log("生成的 ACK 訊息:");
    console.log(ackMessage);
    return ackMessage;
}

const app = hl7.tcp();

app.use(async (req, res, next) => {
    try {
        let message = req.msg;

        if (!message || typeof message.toString !== "function") {
            throw new Error("req.msg 無效，解析失敗");
        }

        // 使用拆分後的解析函式
        const msh = parseMSH(message);
        const pid = parsePID(message);
        const spm = parseSPM(message);
        const orc = parseORC(message);
        const obr = parseOBR(message);
        console.log(`}`)
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
      
       
        // 構建 ACK 訊息（手動方式）
        const ackMessage = buildACKManual(ackStatus, ackText, msh);
         // console.log('orlMessage:')
        //console.log(orlMessage)
      //  console.log('ackMessage:')
      //  console.log(ackMessage)
        // 將 ACK 和 ORL 訊息一起發送
        const response = orlMessage ? `${orlMessage}${ackMessage}` : ackMessage;
        res.end(response);

    } catch (error) {
        console.error("HL7 訊息解析錯誤:", error);
        const msh = null;
        const orlMessage = buildORL34Manual("UA", msh);
        console.log("=處理 OML^O33 訂單無法接受訊息=");
        const ackMessage = buildACKManual("AR", `錯誤: ${error.message}`, msh);
        const response = orlMessage ? `${orlMessage}${ackMessage}` : ackMessage;
        res.end(response);
    }
});

const PORT = 8080;
app.start(PORT);
console.log(`HL7 伺服器已啟動，監聽端口 ${PORT}`);