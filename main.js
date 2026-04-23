const { exec } = require('child_process');

const fs = require('fs').promises;
const path = require('path');



(async () => {
  try {

    const dirPath0 = path.join(__dirname);
    const files0 = await fs.readdir(dirPath0);
    for (const file0 of files0) {
      const dirPath = path.join(__dirname, file0);
      const files = await fs.readdir(dirPath);
      const jsFiles = files.filter(file => file.endsWith('.js'));

      // 使用 for...of 循环
      for (const file of jsFiles) {
        const filePath = path.join(dirPath, file);

        try {
          const content = await fs.readFile(filePath, 'utf8');
          console.log(`读取完成: ${file}`);
          // 在这里处理每个文件的内容

          // 执行 'node script.js' 命令
          const dirPath = path.join(__dirname, file0, '\\');
          exec(dirPath + file, (error, stdout, stderr) => {
            if (error) {
              console.error(`执行错误: ${error}`);
              return;
            }
            console.log(`脚本输出: ${stdout}`); // 输出: 脚本输出: 这是一个独立的脚本
          });


        } catch (readErr) {
          console.error(`读取文件 ${file} 失败:`, readErr);
        }
      }
    }
  } catch (err) {
    console.error('读取目录失败:', err);
  }
})();


