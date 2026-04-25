const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// 1. 读取 log.json 文件
const logFilePath = path.join(__dirname, 'merged-logs.json');
let logData;

try {
    const rawData = fs.readFileSync(logFilePath, 'utf8');
    logData = JSON.parse(rawData);
    console.log('✅ log.json 读取成功');
} catch (error) {
    console.error('❌ 读取文件失败:', error.message);
    process.exit(1); // 文件读取失败则退出
}

// 2. 配置邮件发送器 (Transporter)
// 请根据你的实际邮箱服务商修改 host, port 和 auth 信息
const transporter = nodemailer.createTransport({
    host: "smtp.qq.com",       // 例如: smtp.qq.com, smtp.office365.com
    port: 587,                      // 通常 587 或 465
    secure: false,                  // true 用于 465 端口, false 用于 587
    auth: {
        user: "dvxchen@qq.com", // 你的发件邮箱账号
        pass: "bmvjzubzfzuxdjdb" // 你的邮箱密码或授权码
    }
});


// 1. 读取 JSON 文件
const filePath = path.join(__dirname, 'merged-logs.json');
const rawData = fs.readFileSync(filePath, 'utf8');
const users = JSON.parse(rawData);

const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>用户列表</title>
    <style>
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f4f4f4; }
        tr:nth-child(even) { background-color: #f9f9f9; }
    </style>
</head>
<body>
    <h1>Log</h1>
    <table>
        <thead>
            <tr>
                <th>index</th>
                <th>title</th>
                <th>ts</th>
                <th>event</th>
                <th>row</th>
                <th>step</th>
                <th>url</th>
                <th>sttus</th>
                <th>value</th>
                <th>expected</th>
                <th>startAt</th>
                <th>note</th>
            </tr>
        </thead>
        <tbody>
 
        </tbody>
    </table>
</body>
</html>
`;



// 3. 定义邮件内容
const mailOptions = {
    from: '"系统日志机器人" <dvxchen@qq.com>', // 发件人
    to: "davy.chen@sap.com",        // 收件人
    subject: "当前目录日志报告",     // 邮件主题
    text: "请查看附件中的日志文件。", // 纯文本正文
    html: htmlContent, // HTML 正文
    attachments: [
        {
            filename: 'merged-logs.json',       // 附件文件名
            path: logFilePath           // 附件文件路径
        }
    ]
};

// 4. 发送邮件
async function sendEmail() {
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ 邮件发送成功:', info.messageId);
    } catch (error) {
        console.error('❌ 邮件发送失败:', error.message);
    }
}

sendEmail();