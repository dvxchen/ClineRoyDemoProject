const { exec } = require('child_process');

const fs = require('fs').promises;
const path = require('path');

const fs0 = require('fs');
const fs1 = require('fs');
const fs2 = require('fs-extra');
const fs3 = require('fs');

const { spawn } = require('child_process');
const glob = require('glob'); // 需安装: npm install glob

// 封装：等待单个js执行完毕
function runFile(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path], {
      stdio: 'inherit',
      shell: true
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`文件${path}执行失败`));
    });
  });
}

let allLogs = [];

(async () => {
  try {

    const dirPath0 = path.join(__dirname);
    const files0 = await fs.readdir(dirPath0);
    for (const file0 of files0) {
      const dirPath = path.join(__dirname, file0);

      const stats = fs0.statSync(dirPath);
      if (stats.isDirectory()) {

      } else {
        continue
      }

      const files = await fs.readdir(dirPath);
      const jsFiles = files.filter(file => file.endsWith('.js'));
      // 使用 for...of 循环
      for (const file of jsFiles) {
        const filePath = path.join(dirPath, file);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          console.log(`读取完成: ${file}`);

          const dirPath = path.join(__dirname, file0, '\\');

          //delete  log.json file in parent folder and current folder

          const filePPath = path.join(__dirname, 'log.json');
          const filePPathAll = path.join(__dirname, 'merged-logs.json');
          const fileCPath = path.join(__dirname, file0, 'log.json');

          try {
            await fs2.remove(filePPathAll);
            await fs2.remove(filePPath);
            await fs2.remove(fileCPath);
            console.log('清理完成（无论文件是否存在）');
          } catch (err) {
            console.error('发生错误:', err);
          }

          await runFile(dirPath + file);

          let dataJson = [];

          try {
            dataJson = fs3.readFileSync(fileCPath, 'utf-8');
            console.log('读取内容:', dataJson);
          } catch (err) {
            if (err.code === 'ENOENT') {
              console.log('文件不存在当前目录');
              try {
                dataJson = fs3.readFileSync(filePPath, 'utf-8');
                console.log('读取内容:', dataJson);
              } catch (err) {
                if (err.code === 'ENOENT') {
                  console.log('文件不存在根目录');
                }
              }

            }
          }

          //     const content1 = fs1.readFileSync(dirPath + 'log.json', 'utf8');
          // 假设每行是一个 JSON 对象
          //     const lines = content1.split('\n').filter(line => line.trim());
          //      const jsonLines = lines.map(line => JSON.parse(line));
          allLogs = allLogs.concat(dataJson);




        } catch (readErr) {
          console.error(`读取文件 ${file} 失败:`, readErr);
        }
      }
    }
    try {
      // 3. 写入合并后的文件 (格式化为 JSON 数组)
      const filePPathAllx = path.join(__dirname, 'merged-logs.json');
      fs1.writeFileSync(filePPathAllx, JSON.stringify(allLogs, null, 2));
      console.log('JSON 日志合并完成');

      await runFile(path.join(__dirname, 'email.js'));

    } catch (err) {
      console.error('读取合并文件失败:', err);
    }



  } catch (err) {
    console.error('读取目录失败:', err);
  }
})();


