﻿const initCycleTLS = require("cycletls");
const fetch = require("node-fetch");
const mTransKey = require("./transkey");

class cultureland {
    constructor() {
        this.cookies = [];
        this.cycleTLS = null;
    }

    async check(pin, isMobile = true) {
        const voucherData = await fetch(`https://www.cultureland.co.kr/voucher/getVoucherCheck${isMobile ? "Mobile" : ""}Used.do`, {
            headers: {
                "content-type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            body: "code=" + pin
        }).then(res => res.json());

        return voucherData;
    }

    async balance() {
        if (!await this.isLogin()) throw new Error("ERR_LOGIN_REQUIRED");

        const balance = await fetch("https://m.cultureland.co.kr/tgl/getBalance.json", {
            headers: {
                "cookie": this.cookies.join("; ")
            },
            method: "POST"
        }).then(res => res.json());

        if (balance.resultMessage !== "성공") throw new Error("ERR_BALANCE_FAILED");

        for (const key in balance) {
            if (!isNaN(balance[key])) balance[key] = Number(balance[key]);
        }

        return balance;
    }

    async charge(pin, check = true) {
        //if (!await this.isLogin()) throw new Error("ERR_LOGIN_REQUIRED");

        if (check) {
            //const voucherData = await this.check(pin);
            //console.log(voucherData);

            // TODO: validate voucher codes
        }

        const pageRequest = await fetch(pin[3].length === 4 ? "https://m.cultureland.co.kr/csh/cshGiftCard.do" : "https://m.cultureland.co.kr/csh/cshGiftCardOnline.do", {
            headers: {
                cookie: this.cookies.join("; ")
            }
        });

        for (const cookie of pageRequest.headers.raw()["set-cookie"]) {
            const cookieIndex = this.cookies.findIndex(c => c.startsWith(cookie.split("=")[0]));
            if (cookieIndex) this.cookies[cookieIndex] = cookie.split(";")[0];
            else this.cookies.push(cookie.split(";")[0]);
        }

        const transKey = new mTransKey();
        await transKey.getServletData(this.cookies);
        await transKey.getKeyData(this.cookies);

        const keypad = await transKey.createKeypad(this.cookies, "number", "txtScr14", "scr14", "password");
        const skipData = await keypad.getSkipData();
        const encryptedPin = keypad.encryptPassword(pin[3], skipData);

        const requestBody = `versionCode=&scr11=${pin[0]}&scr12=${pin[1]}&scr13=${pin[2]}&scr14=${"*".repeat(pin[3].length)}&seedKey=${transKey.crypto.encSessionKey}&initTime=${transKey.initTime}&keyIndex_txtScr14=${keypad.keyIndex}&keyboardType_txtScr14=numberMobile&fieldType_txtScr14=password&transkeyUuid=${transKey.crypto.transkeyUuid}&transkey_txtScr14=${encodeURIComponent(encryptedPin)}&transkey_HM_txtScr14=${transKey.crypto.hmacDigest(encryptedPin)}`;
        const chargeRequest = await this.cycleTLS(pin[3].length === 4 ? "https://m.cultureland.co.kr/csh/cshGiftCardProcess.do" : "https://m.cultureland.co.kr/csh/cshGiftCardOnlineProcess.do", {
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                cookie: this.cookies.join("; ")
            },
            body: requestBody,
            ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
            disableRedirect: true
        }, "POST");

        for (const cookie of chargeRequest.headers["Set-Cookie"]) {
            const cookieIndex = this.cookies.findIndex(c => c.startsWith(cookie.split("=")[0]));
            if (cookieIndex) this.cookies[cookieIndex] = cookie.split(";")[0];
            else this.cookies.push(cookie.split(";")[0]);
        }

        if (chargeRequest.status !== 302) throw new Error("ERR_CHARGE_FAILED");

        const chargeResult = await fetch("https://m.cultureland.co.kr/" + chargeRequest.headers.Location, {
            headers: {
                cookie: this.cookies.join("; ")
            }
        }).then(res => res.text());

        const chargeData = chargeResult.split("<tbody>")[1].split("<td>");
        const reason = chargeData[3].split("</td>")[0].replace(/<\/?[\d\w\s='#]+>/g, "");
        const amount = Number(chargeData[4].split("</td>")[0].trim().replace("원", "").replace(/,/g, ""));

        return {
            amount,
            reason
        };
    }

    async gift(amount, quantity, phone) {
        if (!await this.isLogin()) throw new Error("ERR_LOGIN_REQUIRED");

        await fetch("https://m.cultureland.co.kr/gft/gftPhoneApp.do", {
            headers: {
                cookie: this.cookies.join("; ")
            }
        });

        const giftRequest = fetch("https://m.cultureland.co.kr/gft/gftPhoneCashProc.do", {
            headers: {
                cookie: this.cookies.join("; "),
                "content-type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            redirect: "manual",
            body: `revEmail=&sendType=S&userKey=${user_key}&limitGiftBank=N&giftCategory=M&amount=${amount}&quantity=${quantity}&revPhone=${phone}&sendTitl=&paymentType=cash`
        });

        if (giftRequest.status !== 302) throw new Error("ERR_GIFT_FAILED");

        const giftResult = await fetch("https://m.cultureland.co.kr/gft/gftPhoneCfrm.do", {
            headers: {
                cookie: this.cookies.join("; ")
            }
        }).then(res => res.text());

        if (giftResult.includes('<p>선물(구매)하신 <strong class="point">모바일문화상품권</strong>을<br /><strong class="point">요청하신 정보로 전송</strong>하였습니다.</p>')) {
            const giftData = giftResult.split("- 상품권 바로 충전 : https://m.cultureland.co.kr/csh/dc.do?code=")[1].split("&lt;br&gt;");

            return {
                code: giftData[0],
                pin: giftData[8].replace("- 바코드번호 : ", ""),
                reason: "선물(구매)하신 모바일문화상품권을 요청하신 정보로 전송하였습니다"
            };
        }

        throw new Error("ERR_GIFT_FAILED");
    }

    async isLogin() {
        const isLogin = await fetch("https://m.cultureland.co.kr/mmb/isLogin.json", {
            headers: {
                cookie: this.cookies.join("; ")
            },
            method: "POST"
        }).then(res => res.text());

        return isLogin === "true";
    }

    async getUserInfo() {
        if (!this.isLogin()) throw new Error("ERR_LOGIN_REQUIRED");

        const userInfo = await fetch("https://m.cultureland.co.kr/tgl/flagSecCash.json", {
            headers: {
                cookie: this.cookies.join("; ")
            },
            method: "POST"
        }).then(res => res.json());

        if (userInfo.resultMessage !== "성공") throw new Error("ERR_USERINFO_FAILED");

        delete userInfo.user_id;
        delete userInfo.user_key;
        userInfo.CashPwd = userInfo.CashPwd !== "0";
        userInfo.Del_Yn = userInfo.Del_Yn === "Y";
        userInfo.idx = Number(userInfo.idx);
        userInfo.SafeLevel = Number(userInfo.SafeLevel);
        userInfo.userKey = Number(userInfo.userKey);

        return userInfo;
    }

    async login(keepLoginInfo) {
        keepLoginInfo = encodeURIComponent(keepLoginInfo);
        this.cookies.push("KeepLoginConfig=" + keepLoginInfo);
        const loginRequest = await fetch("https://m.cultureland.co.kr/mmb/loginProcess.do", {
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                cookie: this.cookies.join("; ")
            },
            method: "POST",
            redirect: "manual",
            body: "keepLoginInfo=" + keepLoginInfo
        });

        if (loginRequest.headers.raw()["location"] === "https://m.cultureland.co.kr/cmp/authConfirm.do") throw new Error("ERR_LOGIN_RESTRICTED");
        this.cookies = loginRequest.headers.raw()["set-cookie"].map(c => c.split(";")[0]);

        if (loginRequest.status !== 302) throw new Error("ERR_LOGIN_FAILED");

        this.cycleTLS = await initCycleTLS();

        return {
            sessionId: this.cookies.find(c => c.startsWith("JSESSIONID=")).split("=")[1]
        };
    }
}

module.exports = cultureland;
