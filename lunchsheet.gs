/**
 * @OnlyCurrentDoc
 */

const SHEET_USERS = 'Users';
const SHEET_LEDGER = 'Ledger';
const SHEET_DEBT_MATRIX = 'Debt Matrix';

const RANGE_USERS_DATA = 'A2:G';
const RANGE_LEDGER_AUTO_INCREMENT = 'K2';
const RANGE_ACTIVE_SENDER_ID = 'A2';
const RANGE_ACTIVE_GENERAL_FOOD = 'C3:E3';
const RANGE_ACTIVE_GENERAL_FOOD_CELL = 'C3';
const RANGE_ACTIVE_WILL_SEND_EMAIL = 'G3';

const COL_ACTIVE_TRANSFER_MONEY = 4;
const START_ROW_ACTIVE_DATA = 5;

const COL_ACTIVE_DATA_START = 'A';
const COL_ACTIVE_DATA_END = 'F';

const COL_ACTIVE_ID = 'A';
const COL_ACTIVE_AMOUNT = 'B';
const COL_ACTIVE_RESET_START = 'D';
const COL_ACTIVE_RESET_END = 'F';

const COL_LEDGER_DATA_START = 'B';
const COL_LEDGER_DATA_END = 'J';

const ROW_DEBT_MATRIX_START = 7;
const COL_DEBT_MATRIX_START = 2; // Column B

let gUserDatabase = [];

function onOpen_InstalledTrigger() {
  showChangelog();
}

function showChangelog() {
  const logs=[
    {
      date: '2025-06-29T00:00:00.001+07:00',
      title: 'Nice',
      messages: [
        'Tối ưu tốc độ sheet.',
      ],
    },
    {
      date: '2024-11-27T00:00:00.001+07:00',
      title: 'London 2',
      messages: [
        '"Tối giản nợ" chuyển sang dùng Proof-of-Anti-Stake (PoAS) thay cho Proof-of-Stake (PoS).',
        'Chặn việc tối giản nợ khi người khác đang thanh toán QR.',
        'EZLedger - Sheet Ledger thân thiện hơn với người dùng đã được tạo.'
      ],
    },
    {
      date: '2024-11-26T00:00:00.001+07:00',
      title: 'London',
      messages: [
        'Fix race condition khi thanh toán bằng mutex (sẽ được test bởi user, mong đừng deadlock :P)',
        'Sheet "Ma trận nợ nần" được tạo, tính năng đơn giản hoá số lượng giao dịch đã hoạt động được 🎉'
      ]
    },
  ];

  const userPersistentData = getUserPersistentData();
  const lastSeenChangelog = userPersistentData.lastSeenChangelog ?? new Date(0);

  if (new Date(lastSeenChangelog) >= new Date(logs[0].date)) return;

  const logsStringified = logs.map(log => {
    const date = new Date(log.date);
    const dateString = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
    const messages = log.messages.map(m => `<li>${m}</li>`).join('');
    return `<h2>${dateString}${log.title != null ? ` - ${log.title}` : ''}</h2><ul>${messages}</ul>`;
    }).join('');

  const htmlOutput = HtmlService
    .createHtmlOutput(
        `<style>
            * {
                font-family: monospace;
            }

            h2 {
                margin-bottom: 0;
            }
            ul {
                margin-top: 0;
            }
        </style>
        <div>${logsStringified}</div>`)
    .setWidth(500)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Changelog');

  userPersistentData.lastSeenChangelog = new Date();
  setUserPersistentData(userPersistentData);
}


function getAppPersistentData() {
  return getPersistentData('app_data');
}

function setAppPersistentData(data) {
  setPersistentData('app_data', data);
}

function getUserPersistentData() {
  return getPersistentData(`user_data:${Session.getActiveUser().getEmail()}`);
}

function setUserPersistentData(data) {
  setPersistentData(`user_data:${Session.getActiveUser().getEmail()}`, data);
}

// Use developer metadata to store user data
function getPersistentData(key) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  const metadatafinder = sheet.createDeveloperMetadataFinder().withKey(key);
  const metadata = metadatafinder.find();
  if (metadata.length === 0) {
    return {};
  }

  return JSON.parse(metadata[0].getValue());
}

function setPersistentData(key, data) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  const metadatafinder = sheet.createDeveloperMetadataFinder().withKey(key);
  const metadata = metadatafinder.find();
  if (metadata.length === 0) {
    sheet.addDeveloperMetadata(key, JSON.stringify(data));
  } else {
    metadata[0].setValue(JSON.stringify(data));
  }
}

function debugGetUserPersistentData() {
  Logger.log(getUserPersistentData());
}

function startCriticalSection(ms=5000) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ms)) {
      SpreadsheetApp.getUi().alert('Xử lý race condition thất bại, vui lòng thử lại sau (và nhớ báo Hiếu :D)');
      return false;
  }
  return true;
}

function endCriticalSection() {
  LockService.getScriptLock().releaseLock();
}

function onEdit_InstalledTrigger(e) {
  const isOldFalsy = e.oldValue === false || e.oldValue === 'false' || e.oldValue === 'FALSE';
  const isNewTruthy = e.value === true || e.value === 'true' || e.value === 'TRUE';
  const isInTransferMoneyColumn = e.range.columnStart === COL_ACTIVE_TRANSFER_MONEY && e.range.columnEnd === COL_ACTIVE_TRANSFER_MONEY;
  const isChangingOneRow =  e.range.rowStart === e.range.rowEnd;

  if(!(isOldFalsy && isNewTruthy && isChangingOneRow && isInTransferMoneyColumn)) return;

  const sheet = SpreadsheetApp.getActiveSheet();
  
  console.time('Uncheck checkbox');
  // uncheck checkbox
  sheet.getRange(e.range.rowStart, e.range.columnStart).setValue(false);
  console.timeEnd('Uncheck checkbox');

  console.time('Get amount');
  const rowSelected = e.range.rowStart;
  const amount = sheet.getRange(COL_ACTIVE_AMOUNT + rowSelected).getValue();
  console.timeEnd('Get amount');

  if (!(amount > 0)) return;

  console.time('Get user database');
  gUserDatabase = getUserDatabase();
  console.timeEnd('Get user database');

  console.time('Get sender and receiver id');
  const senderId = sheet.getRange(RANGE_ACTIVE_SENDER_ID).getValue();
  const receiverId = sheet.getRange(COL_ACTIVE_ID + rowSelected).getValue();
  console.timeEnd('Get sender and receiver id');

  console.time('Check conditions');

  if (!senderId || !receiverId || senderId == receiverId) return;
  if (!(gUserDatabase.some(u => u.id === senderId) && gUserDatabase.some(u => u.id === receiverId))) return;

  const receiver = gUserDatabase.find(u => u.id === receiverId);
  const sender = gUserDatabase.find(u => u.id === senderId);

  if (!receiver.bankName || !receiver.bankAccountNumber) return;

  console.timeEnd('Check conditions');

  {
    console.time('Get app data');
    const appData = getAppPersistentData();
    console.timeEnd('Get app data');
    const coolDownReasons = appData.minimizeTransactionsCoolDown?.reasons ?? [];
    coolDownReasons.push(`${sender.name} đang thanh toán QR cho ${receiver.name}`);

    appData.minimizeTransactionsCoolDown = {
      reasons: coolDownReasons,
      date: new Date(),
      period: 2 * 60 * 1000, // 2 minutes
    }

    console.time('Set app data');
    setAppPersistentData(appData);
    console.timeEnd('Set app data');
  }

  console.time('Show QR');
  showQR(receiver.bankName, receiver.bankAccountNumber, amount, receiver.name, `${sender.name} auto trả tiền bằng QR`, senderId, receiverId);
  console.timeEnd('Show QR');
}

function showQR(bank, accountId, amount, name, message, senderId, receiverId) {
  const ui = SpreadsheetApp.getUi();
  const template = HtmlService.createTemplateFromFile('QuickQR');

  template.bank=bank;
  template.accountId =accountId;
  template.amount = amount;
  template.name = name;
  template.message = message;

  template.senderId = senderId;
  template.receiverId = receiverId;

  const html = template.evaluate().setHeight(600).setWidth(500);

  ui.showModalDialog(html, 'QR trả tiền');
}

function addLedgerAutoTrảRecord(senderId, receiverId, amount) {
  const spreadsheet = SpreadsheetApp.getActive();

  const ledgerSheet = spreadsheet.getSheetByName(SHEET_LEDGER);
  
  startCriticalSection();

  const autoIncrement = ledgerSheet.getRange(RANGE_LEDGER_AUTO_INCREMENT).getValue();

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  const modifiedRange = ledgerSheet.getRange(COL_LEDGER_DATA_START + (autoIncrement + 1) + ":" + COL_LEDGER_DATA_END + (autoIncrement + 1));
  const formulasInRange = modifiedRange.getFormulas();

  modifiedRange.setValues([[
      senderId, 
      formulasInRange[0][1] ?? '', 
      'Trả', 
      receiverId, 
      formulasInRange[0][4] ?? '', 
      now, 
      amount, 
      'Auto trả tiền bằng QR', 
      '',
    ]]);

  endCriticalSection();
    
  spreadsheet.toast("Thực hiện thành công");
}

function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function addLedgerNợRecordsDetectEmail() {
  const currentUser = Session.getActiveUser().getEmail();
  const userId = currentUser.match(/(.*)@/)[1];
  addLedgerNợRecords(userId);
}

function addLedgerTrảRecordsDetectEmail() {
  const currentUser = Session.getActiveUser().getEmail();
  const userId = currentUser.match(/(.*)@/)[1];
  addLedgerTrảRecords(userId);
}

function addLedgerNợRecords(id) {
  const recipients = extractData().users;

  const willSendEmails = activeSheetWillSendEmails();


  addRecords(true, id, recipients, willSendEmails);
}

function addLedgerTrảRecords(id) {
  const recipients = extractData().users;

  const willSendEmails = false;

  addRecords(false, id, recipients, willSendEmails);
}

function isBlank(str) {
  return str == null || (typeof str === 'string' && str.trim() === '');
}

function isNumeric(str) {
  if (typeof str === 'number') return true;
  if (typeof str !== 'string') return false; // we only process strings!  
  return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseFloat(str)); // ...and ensure strings of whitespace fail
}

function extractData() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const range = sheet.getRange(RANGE_ACTIVE_GENERAL_FOOD);
  const generalFood = range.getMergedRanges()[0].getValue() ?? "";
  var dataRange = sheet.getRange(COL_ACTIVE_DATA_START + START_ROW_ACTIVE_DATA + ":" + COL_ACTIVE_DATA_END + sheet.getLastRow());
  var data = dataRange.getValues();
  
  const users = [];
  
  for (let i = 0; i < data.length; i++) {
    const costUnprocessed = data[i][3] || 0;
    const name = data[i][2];
    if (!(isBlank(costUnprocessed) || isNumeric(costUnprocessed))) throw `Số tiền không hợp lệ cho ${name}:"${costUnprocessed}"`;
    let costProcessed = (costUnprocessed > 0 && costUnprocessed < 1000) ? costUnprocessed*1000 : costUnprocessed;
    costProcessed = Math.round(costProcessed);
    const user = {
      "id": data[i][0],
      "name": name,
      "cost": costProcessed,
      "food": data[i][4] || generalFood,
      "note": data[i][5]
    };
    if (!user.id || user.cost == 0) continue;
    users.push(user);
  }
  
  const result = {
    generalFood,
    users
  };
  
  Logger.log(result);
  return result;
}

function activeSheetWillSendEmails() {
  return SpreadsheetApp.getActiveSheet().getRange(RANGE_ACTIVE_WILL_SEND_EMAIL).getValue() === true;
}

function resetData() {
  const sheet = SpreadsheetApp.getActiveSheet();

  const idRange = sheet.getRange(COL_ACTIVE_ID + START_ROW_ACTIVE_DATA + ":" + COL_ACTIVE_ID + sheet.getLastRow());
  const ids = idRange.getValues();
  
  const dataRange = sheet.getRange(COL_ACTIVE_RESET_START + START_ROW_ACTIVE_DATA + ":" + COL_ACTIVE_RESET_END + sheet.getLastRow());
  const data = dataRange.getValues();
  
  // Set cost cell to 0
  for (let i = 0; i < data.length; i++) {
    if(!ids[i][0]) continue;
    data[i][0] = 0; // Column D (index 3) represents the cost
    data[i][1] = '';
    data[i][2] = '';
  }

  sheet.getRange(RANGE_ACTIVE_GENERAL_FOOD_CELL).setValue('');
  
  
  // Update the data back to the sheet
  dataRange.setValues(data);
}

function getUserDatabase() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  const data = sheet.getRange(RANGE_USERS_DATA).getValues();
  
  const users = [];
  
  for (let i = 0; i < data.length; i++) {
    const user = {
      "id": data[i][0],
      "name": data[i][1],
      "team": data[i][2],
      "homePage": data[i][3],
      "bankAccountNumber": data[i][5],
      "bankName": data[i][6]
    };
    if (!user.id) continue;
    users.push(user);
  };
  
  return users;
}

function addRecords(isRequestingOthersToPay, sendUser, receiveUsers, willSendEmails = false) {
  const spreadsheet = SpreadsheetApp.getActive();

  const ui = SpreadsheetApp.getUi();

  if(!receiveUsers.length) {
    ui.alert('Bạn chưa thêm số tiền cho ai cả!');
    return;
  }

  const unfilledFoodUsers = receiveUsers.filter(u => u.food === '' || u.food == null).map(u => u.name);
  if (unfilledFoodUsers.length) {
    ui.alert(`Bạn chưa điền món ăn cho ${unfilledFoodUsers.join(', ')}`);
    return;
  }

  let title, contentMsg;
  if (isRequestingOthersToPay) {
    title = 'Yêu cầu người khác trả tiền';
    contentMsg = `Bạn là ${sendUser} và bạn muốn:\n`;
    contentMsg += receiveUsers.map(u => `- ${u.name} trả ${numberWithCommas(u.cost)} VND cho ${u.food || '???'}`).join('\n');
  } else {
    title = 'Bạn thanh toán tiền cho người khác';
    contentMsg = `Bạn là ${sendUser} và bạn muốn:\n`;
    contentMsg += receiveUsers.map(u => `- Trả ${numberWithCommas(u.cost)} VND cho ${u.name} vì ${u.food || '???'}`).join('\n');
  }

  const response = ui.alert(title, contentMsg, ui.ButtonSet.YES_NO);


  if (response !== ui.Button.YES) {
    return;
  }

  const ledgerSheet = spreadsheet.getSheetByName(SHEET_LEDGER);
  
  startCriticalSection();

  const autoIncrement = ledgerSheet.getRange(RANGE_LEDGER_AUTO_INCREMENT).getValue();

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  const modifiedRange = ledgerSheet.getRange(COL_LEDGER_DATA_START + (autoIncrement + 1) + ":" + COL_LEDGER_DATA_END + (autoIncrement + receiveUsers.length));
  const formulasInRange = modifiedRange.getFormulas();
  
  const data = receiveUsers.map((u,i) =>
    [
      isRequestingOthersToPay ? u.id : sendUser, 
      formulasInRange[i][1] ?? '', 
      isRequestingOthersToPay ? 'Nợ' : 'Trả', 
      isRequestingOthersToPay ? sendUser : u.id, 
      formulasInRange[i][4] ?? '', 
      now, 
      u.cost, 
      u.food || '', 
      u.note || '',
    ]
  );
  
  modifiedRange.setValues(data);

  endCriticalSection();

  resetData();

  spreadsheet.toast("Thực hiện thành công");

  // ol custom logic. Slow task should start last
  if(willSendEmails) {
    sendEmail(receiveUsers.map(u => ({email: `${u.id}@orangelogic.com`, food: u.food, name: u.name, cost: u.cost})), sendUser)
  }
}

const ALLOWED_MINIMIZE_TRANSACTIONS_EMAILS = [
  'hieu.dao@orangelogic.com',
  'dung.phung@orangelogic.com'
];

function minimizeTransactions() {
  if (!ALLOWED_MINIMIZE_TRANSACTIONS_EMAILS.includes(Session.getActiveUser().getEmail())) {
    SpreadsheetApp.getUi().alert('Bạn không có quyền thực hiện chức năng này.');
    return;
  }

  const appData = getAppPersistentData();
  const coolDown = appData.minimizeTransactionsCoolDown;
  if (coolDown) {
    const now = new Date();
    const lastTime = new Date(coolDown.date);
    if (now - lastTime < coolDown.period) {
      const waitTime = Math.ceil((coolDown.period - (now - lastTime)) / 1000);
      const reasonsText = coolDown.reasons.map(r => '- '+ r).join('\n');
      SpreadsheetApp.getUi().alert(`Bạn cần chờ ${waitTime} giây nữa để thực hiện tối giản nợ nần. Lý do: \n${reasonsText}`);
      return
    } else {
      appData.minimizeTransactionsCoolDown = null;
      setAppPersistentData(appData);
    }
  }

  const spreadsheet = SpreadsheetApp.getActive();

  const debtMatrixSheet = spreadsheet.getSheetByName(SHEET_DEBT_MATRIX);
  const numUsers = getUserDatabase().length;
  const range = debtMatrixSheet.getRange(ROW_DEBT_MATRIX_START, COL_DEBT_MATRIX_START, numUsers + 2, numUsers).getValues();

  const users = range[1];
  const stakes = range[0];
  const debts = range.slice(2);

  // debug all the data
  // Logger.log(users);
  // Logger.log(stakes);
  // Logger.log(debts);

  const transactionsToApply = [];

  // Step 1: Equalize debts
  const step1Transactions = [];
  for (let payee = 0; payee < users.length; payee++) {
    for (let payer = 0; payer < users.length; payer++) {
      if (payer === payee) continue;
      const debt = debts[payer][payee];
      if (debt >= 0) continue;
      step1Transactions.push({
        payer: users[payee],
        payee: users[payer],
        amount: -debt,
      });
    }
  }
  step1Transactions.forEach(t => {
    transactionsToApply.push(
      {
        sideA: t.payer,
        sideB: t.payee,
        amount: t.amount,
        type: 'Trả',
        message: 'Bước 1: Cân bằng nợ nần về 0'
      }
    );
  });

  // debug step 1 transactions
  Logger.log(step1Transactions);

  // Step 2: Negative stakers send money to the stakemaster
  const stakeMaster = users[stakes.indexOf(Math.min(...stakes))];

  const step2Transactions = [];
  for (let i = 0; i < users.length; i++) {
    if (stakes[i] < 0) {
      step2Transactions.push({
        payer: users[i],
        payee: stakeMaster,
        amount: -stakes[i],
      });
    }
  }

  step2Transactions.forEach(t => {
    transactionsToApply.push(
      {
        sideA: t.payer,
        sideB: t.payee,
        amount: t.amount,
        type: 'Nợ',
        message: 'Bước 2: Người nợ trả tiền cho stakemaster'
      }
    );
  });

  // debug step 2 transactions
  Logger.log(step2Transactions);

  // Step 3: Stakemaster sends money to the positive stakers
  const step3Transactions = [];
  for (let i = 0; i < users.length; i++) {
    if (stakes[i] > 0 && users[i] !== stakeMaster) {
      step3Transactions.push({
        payer: stakeMaster,
        payee: users[i],
        amount: stakes[i],
      });
    }
  }
  step3Transactions.forEach(t => {
    transactionsToApply.push(
      {
        sideA: t.payer,
        sideB: t.payee,
        amount: t.amount,
        message: 'Bước 3: Stakemaster trả tiền cho người bị nợ',
        type: 'Nợ'
      }
    );
  });

  // debug step 3 transactions
  Logger.log(step3Transactions);

  // debug all transactions
  // Logger.log(transactionsToApply);

  const ui = SpreadsheetApp.getUi();

  if (!transactionsToApply.length) {
    ui.alert('Không có giao dịch nào cần thực hiện.');
    return;
  }

  const response = ui.alert('Xác nhận thực hiện', `Bạn có chắc chắn muốn thực hiện ${transactionsToApply.length} giao dịch để tối giản nợ nần?`, ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) {
    return;
  }


  // Step 4: Actualize transactions
  const ledgerSheet = spreadsheet.getSheetByName(SHEET_LEDGER);

  startCriticalSection();

  const autoIncrement = ledgerSheet.getRange(RANGE_LEDGER_AUTO_INCREMENT).getValue();

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  const modifiedRange = ledgerSheet.getRange(COL_LEDGER_DATA_START + (autoIncrement + 1) + ":" + COL_LEDGER_DATA_END + (autoIncrement + transactionsToApply.length));

  const data = transactionsToApply.map(t =>
    [
      t.sideA,
      '',
      t.type,
      t.sideB,
      '',
      now,
      t.amount,
      t.message,
      '',
    ]
  );

  Logger.log(data);
  
  modifiedRange.setValues(data);

  endCriticalSection();

  spreadsheet.toast("Thực hiện thành công");
}

const RESEND_API_KEY = 're_E5GbP3AX_LncYcQ6gw9Y8kzHcgsnFLzrD';

// recipient {
//   email
//   name
//   food
//   cost
// }

function sendEmail(recipients, payerName) {
  let A = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <title>Email Receipt</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style type="text/css">
      /**
   * Google webfonts. Recommended to include the .woff version for cross-client compatibility.
   */
      @media screen {
        @font-face {
          font-family: "Source Sans Pro";
          font-style: normal;
          font-weight: 400;
          src: local("Source Sans Pro Regular"), local("SourceSansPro-Regular"),
            url(https://fonts.gstatic.com/s/sourcesanspro/v10/ODelI1aHBYDBqgeIAH2zlBM0YzuT7MdOe03otPbuUS0.woff)
              format("woff");
        }

        @font-face {
          font-family: "Source Sans Pro";
          font-style: normal;
          font-weight: 700;
          src: local("Source Sans Pro Bold"), local("SourceSansPro-Bold"),
            url(https://fonts.gstatic.com/s/sourcesanspro/v10/toadOcfmlt9b38dHJxOBGFkQc6VGVFSmCnC_l7QZG60.woff)
              format("woff");
        }
      }

      /**
   * Avoid browser level font resizing.
   * 1. Windows Mobile
   * 2. iOS / OSX
   */
      body,
      table,
      td,
      a {
        -ms-text-size-adjust: 100%; /* 1 */
        -webkit-text-size-adjust: 100%; /* 2 */
      }

      /**
   * Remove extra space added to tables and cells in Outlook.
   */
      table,
      td {
        mso-table-rspace: 0pt;
        mso-table-lspace: 0pt;
      }

      /**
   * Better fluid images in Internet Explorer.
   */
      img {
        -ms-interpolation-mode: bicubic;
      }

      /**
   * Remove blue links for iOS devices.
   */
      a[x-apple-data-detectors] {
        font-family: inherit !important;
        font-size: inherit !important;
        font-weight: inherit !important;
        line-height: inherit !important;
        color: inherit !important;
        text-decoration: none !important;
      }

      /**
   * Fix centering issues in Android 4.4.
   */
      div[style*="margin: 16px 0;"] {
        margin: 0 !important;
      }

      body {
        width: 100% !important;
        height: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      /**
   * Collapse table borders to avoid space between cells.
   */
      table {
        border-collapse: collapse !important;
      }

      a {
        color: #1a82e2;
      }

      img {
        height: auto;
        line-height: 100%;
        text-decoration: none;
        border: 0;
        outline: none;
      }

      /**
       * Gmail auto quote color fix
       */
      .im {
        color: inherit !important;
      }
      div > span.im {
        color: inherit !important;
      }
      p > span.im {
        color: inherit !important;
      }
    </style>
  </head>
  <body style="padding: 100px 0;background-color: #d2c7ba">
    <!-- start preheader -->
    <div
      class="preheader"
      style="
        display: none;
        max-width: 0;
        max-height: 0;
        overflow: hidden;
        font-size: 1px;
        line-height: 1px;
        color: #fff;
        opacity: 0;
      "
    >
      Here's the lunch bill today.
    </div>
    <!-- end preheader -->

    <!-- start body -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
      <!-- start hero -->
      <tr>
        <td align="center" bgcolor="#D2C7BA">
          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="max-width: 600px"
          >
            <tr>
              <td
                align="left"
                bgcolor="#ffffff"
                style="
                  padding: 36px 24px 0;
                  font-family: 'Source Sans Pro', Helvetica, Arial, sans-serif;
                  border-top: 3px solid #d4dadf;
                "
              >
                <h1
                  style="
                    margin: 0;
                    font-size: 32px;
                    font-weight: 700;
                    letter-spacing: -1px;
                    line-height: 48px;
                  "
                >
                  Here is today's lunch bill for our team members.
                </h1>
                <div style="padding-top:20px;">
                  <div style="float: left; font-size:20px;">
                    ${payerName ? `Paid by <strong>${payerName}</strong>`:''}
                  </div>
                  <div style="float: right; font-size:20px">
                    <a href="https://docs.google.com/spreadsheets/d/1UBsAs382lG_BhtKt81z-N7nr9Z_Cr84SascIUOOC6pw">Spreadsheet</a>
                  </div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- end hero -->

      <!-- start copy block -->
      <tr>
        <td align="center" bgcolor="#D2C7BA">
          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="max-width: 600px"
          >

            <!-- start receipt table -->
            <tr>
              <td
                align="left"
                bgcolor="#ffffff"
                style="
                  padding: 6px 24px 24px 24px;
                  font-family: 'Source Sans Pro', Helvetica, Arial, sans-serif;
                  font-size: 16px;
                  line-height: 24px;
                "
              >
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td
                      align="left"
                      bgcolor="#D2C7BA"
                      style="
                        padding: 12px;
                        font-family: 'Source Sans Pro', Helvetica, Arial,
                          sans-serif;
                        font-size: 16px;
                        line-height: 24px;
                      "
                    >
                      <strong>Name</strong>
                    </td>
                    <td
                    align="left"
                    bgcolor="#D2C7BA"
                    style="
                      padding: 12px;
                      font-family: 'Source Sans Pro', Helvetica, Arial,
                        sans-serif;
                      font-size: 16px;
                      line-height: 24px;
                    "
                  >
                    <strong>Food</strong>
                  </td>
                    <td
                      align="left"
                      bgcolor="#D2C7BA"
                      style="
                        padding: 12px;
                        font-family: 'Source Sans Pro', Helvetica, Arial,
                          sans-serif;
                        font-size: 16px;
                        line-height: 24px;
                      "
                    >
                      <strong>Cost</strong>
                    </td>
                  </tr>
                  `
                  let B_repeat = ({name, food, cost}) => `
                  <tr>
                    <td
                      align="left"
                      style="
                        padding: 6px 12px;
                        font-family: 'Source Sans Pro', Helvetica, Arial,
                          sans-serif;
                        font-size: 16px;
                        line-height: 24px;
                      "
                    >
                      ${name ?? ""}
                    </td>
                    <td
                    align="left"
                    style="
                      padding: 6px 12px;
                      font-family: 'Source Sans Pro', Helvetica, Arial,
                        sans-serif;
                      font-size: 16px;
                      line-height: 24px;
                    "
                  >
                    ${food ?? ""}
                  </td>
                    <td
                      align="left"
                      style="
                        padding: 6px 12px;
                        font-family: 'Source Sans Pro', Helvetica, Arial,
                          sans-serif;
                        font-size: 16px;
                        line-height: 24px;
                      "
                    >
                      ${numberWithCommas(cost ?? 0)} VND
                    </td>
                  </tr>
                  `
                  let C_total = (total) => `<tr>
                    <td
                      align="left"
                      style="
                        padding: 12px;
                        font-family: 'Source Sans Pro', Helvetica, Arial,
                          sans-serif;
                        font-size: 16px;
                        line-height: 24px;
                        border-top: 2px dashed #d2c7ba;
                        border-bottom: 2px dashed #d2c7ba;
                      "
                    >
                      <strong>Total</strong>
                    </td>
                    <td
                    align="left"
                    style="
                      padding: 12px;
                      font-family: 'Source Sans Pro', Helvetica, Arial,
                        sans-serif;
                      font-size: 16px;
                      line-height: 24px;
                      border-top: 2px dashed #d2c7ba;
                      border-bottom: 2px dashed #d2c7ba;
                    "
                  >
                  </td>
                    <td
                      align="left"
                      style="
                        padding: 12px;
                        font-family: 'Source Sans Pro', Helvetica, Arial,
                          sans-serif;
                        font-size: 16px;
                        line-height: 24px;
                        border-top: 2px dashed #d2c7ba;
                        border-bottom: 2px dashed #d2c7ba;
                      "
                    >
                      <strong>${numberWithCommas(total)} VND</strong>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- end reeipt table -->
          </table>
        </td>
      </tr>
      <!-- end copy block -->

          </table>
        </td>
      </tr>
      <!-- end footer -->
    </table>
    <!-- end body -->
  </body>
</html>`

  const url = 'https://api.resend.com/emails';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY,
    },
    payload: JSON.stringify({
      from: `Hieu's Lunch Bot <lunch.bot@hieu.moe>`,
      to: recipients.map(r => r.email),
      subject: "Today's lunch bill",
      html: A + recipients.map(r => B_repeat({name: r.name, food: r.food, cost: r.cost})).join('\n') + C_total(recipients.reduce((acc,cur) => acc+cur.cost, 0))
    })
  };
  
  const response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() == 200) {
    const data = JSON.parse(response.getContentText());
    return data;
  }
}