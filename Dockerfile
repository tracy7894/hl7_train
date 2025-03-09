ㄣ# 使用 Node.js LTS 版本作為基底映像
FROM node:18

# 設定工作目錄
WORKDIR /usr/src/app

# 複製專案檔案到容器中
COPY package*.json ./

# 安裝專案依賴
RUN npm install

# 複製剩餘的程式碼
COPY . .

# 暴露容器內的埠號 (例：8080)
EXPOSE 8080

# 啟動應用程式
CMD ["node", "index.js"]