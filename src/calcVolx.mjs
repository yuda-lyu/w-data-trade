import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import isenum from 'wsemi/src/isenum.mjs'
import iseint from 'wsemi/src/iseint.mjs'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import resolvePeriods from './resolvePeriods.mjs'


/**
 * 計算各週期波動之延伸(Volatility extensions: 已實現波動、以開高低收估之波動、短長比、Choppiness、下行占比、跳躍占比、變異數比、波動之波動)
 *
 * 讀取Open、High、Low、Close欄位(key目前未被使用，僅為與其他指標介面一致而保留)，只用當根(含)以前之資料，逐根因果
 * 記號：lo、lh、ll、lc為開、高、低、收之對數，r(i)=lc(i)-lc(i-1)(i至少為1)，視窗W(i,m)為第i-m+1至i根(含當根共m根)，期別之根數為len
 * 逐根之量：pk=(lh-ll)²/(4 ln2)，gk=0.5(lh-ll)²-(2 ln2-1)(lc-lo)²，rs=(lh-lc)(lh-lo)+(ll-lc)(ll-lo)，tr=max(lh,前一根lc)-min(ll,前一根lc)(i至少為1)；lnv(x)=0.5×ln(max(x,opt.eps))
 * 各欄(第i根)：
 * rv=lnv(r²於W(i,len)之平均)，已實現波動(對數)
 * park=lnv(pk於W(i,len)之平均)，gk=lnv(gk於W(i,len)之平均)，rs=lnv(rs於W(i,len)之平均)，以高低(與開收)估之波動(對數)，平均不大於0者亦取opt.eps
 * rvRatio=rv(i)-lnv(r²於W(i,len×opt.longMult)之平均)，短長期已實現波動之比(對數之差)
 * chop=log10(tr於W(i,len)之和/(W內lh之最大-ll之最小))/log10(len)，Choppiness(趨勢近0、盤整近1)，高低差不大於0(或tr之和不大於0)時回0
 * downShare=W(i,len)內r小於0者之r²之和/全部r²之和，下行之占比，分母為0時回0.5
 * jumpShare=1-(π/2)×(|r(j)||r(j-1)|於j∈W(i,len)之平均)/(r²於W(i,len)之平均)，跳躍之占比，分母為0時回0；估計式本身不截斷，值域為(−∞,1]，雙冪次變差大於已實現變異時為負(估計誤差)，視窗短(len不大於5)時可為甚大之負值，僅需非負之占比者自行取max(0,jumpShare)
 * varRatio=((lc(j)-lc(j-opt.vrLag))²於j∈W(i,len)之平均)/(opt.vrLag×r²於W(i,len)之平均)，變異數比，分母為0時回1
 * volOfVol=u(j)於j∈W(i,len)之母體標準差(全部相同者為0)，u(j)=lnv(r²於W(j,opt.vovLen)之平均)，波動之波動
 * 各期第一筆對應輸入索引s0=各欄所需最早一根之最大者：rv、chop、downShare需i-len+1至少為1；park、gk、rs需至少為0；jumpShare需至少為2；rvRatio需i至少為len×opt.longMult；varRatio需i-len+1至少為opt.vrLag；volOfVol需i-len+1至少為opt.vovLen(u(j)需j至少為opt.vovLen)
 * 即s0=max(len×opt.longMult, len+1, len+opt.vrLag-1, len+opt.vovLen-1)，其後逐根對齊至最後一根，資料筆數n小於s0+1時該期vs回空陣列
 * len須為至少2之整數(chop除以log10(len))，內建週期表皆符合；opt.kp之值不符時reject；各欄於資料充足時皆為有限數值(不輸出NaN或Infinity)
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcVolx.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time、Open、High、Low、Close欄位，四者皆須為正之有限數且Low不大於Open與Close、High不小於Open與Close(高低涵蓋開收，亦即High不小於Low)，否則reject(任一根無效或自相矛盾即整批reject；訊息不含輸入值)；null、undefined、{}(以lodash size計為0根)視為無資料，各期vs為空陣列
 * @param {String} key 輸入計算所用數值欄位名稱字串，本指標固定讀取Open/High/Low/Close欄位，key目前未被使用，僅為與其他指標介面一致而保留
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number|String} [opt.longMult=4] 輸入長視窗相對於期別根數之倍數，至少為2之整數(數值或數字字串，數字字串轉為數值使用)，預設4，非預期之輸入(含小於2、非整數、非數值)視為未給而改用預設
 * @param {Number|String} [opt.vrLag=6] 輸入變異數比之落後根數，至少為2之整數(數值或數字字串，數字字串轉為數值使用)，預設6，非預期之輸入視為未給而改用預設
 * @param {Number|String} [opt.vovLen=6] 輸入波動之波動中逐根波動所用之根數，至少為2之整數(數值或數字字串，數字字串轉為數值使用)，預設6，非預期之輸入視為未給而改用預設
 * @param {Number|String} [opt.eps=1e-12] 輸入波動取對數前之下限，有限且大於0之數值(數值或數字字串，數字字串轉為數值使用)，預設1e-12，非預期之輸入(含0、負數、非有限數、非數值)視為未給而改用預設
 * @param {Number|String} [opt.intervalSec=14400] 輸入每根K線之秒數，60之正整數倍且至多31536000(數值或數字字串)，各期根數不變(根數為本)，期別標籤為根數×每根秒數之時間跨度(例：每根1day時3根之期為'3day')，預設14400(每根4hr，標籤與根數皆同內建表)，無效時reject
 * @param {Object} [opt.kp] 輸入直接採用之週期表物件，鍵為週期標籤，值為至少為2之整數根數，給予時不換算，預設採內建週期表，非預期之輸入(非物件、空物件、任一值非正整數)視為未給；值為正整數但小於2或為參數物件者reject
 * @param {Boolean} [opt.debug=false] 輸入是否於opt.kp、opt.longMult、opt.vrLag、opt.vovLen、opt.eps出現非預期輸入(視為未給、改用預設)時輸出警告布林值，預設false；警告為固定詞彙、不含傳入之值，同一個鍵每個行程只警告一次
 * @param {Function} [opt.funLog] 輸入警告出口函數，以(msg, { fn, reason, key })呼叫，未給則用console.warn，預設未給
 * @returns {Promise} 回傳Promise，resolve為各期結果陣列，各元素為{period,len,vs}，vs內各元素為{time,rv,park,gk,rs,rvRatio,chop,downShare,jumpShare,varRatio,volOfVol}
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Open: 100, High: 102, Low: 99, Close: 101 },
 *     { time: '2020-01-01T04:00:00', Open: 101, High: 104, Low: 100, Close: 103 },
 *     { time: '2020-01-01T08:00:00', Open: 103, High: 105, Low: 101, Close: 102 },
 *     { time: '2020-01-01T12:00:00', Open: 102, High: 108, Low: 101, Close: 106 },
 *     { time: '2020-01-01T16:00:00', Open: 106, High: 107, Low: 103, Close: 104 },
 *     { time: '2020-01-01T20:00:00', Open: 104, High: 106, Low: 102, Close: 105 },
 * ]
 *
 * calcVolx(arr, 'Close', { longMult: 2, vrLag: 2, vovLen: 2, kp: { '8hr': 2 } })
 *     .then((rs) => {
 *         console.log(rs[0])
 *         // => {
 *         //   period: '8hr',
 *         //   len: 2,
 *         //   vs: [
 *         //     { time: '2020-01-01T16:00:00', rv: -3.4948926800720095, park: -3.419316236254498, gk: -3.39292949656469, rs: -3.432136987313123, rvRatio: 0.23088247302778342, chop: 0.6494439658123444, downShare: 0.19692591467747111, jumpShare: 0.05538753862252899, varRatio: 0.3260080709086289, volOfVol: 0.03924121837922345 },
 *         //     { time: '2020-01-01T20:00:00', rv: -4.194830995946551, park: -3.772626954262258, gk: -3.6730947630270663, rs: -3.673962302353813, rvRatio: -0.4016382829038778, chop: 0.6780058293928951, downShare: 0.7984754500747242, jumpShare: -2.162947831834348, varRatio: 0.5137547286750295, volOfVol: 0.34996915793727057 }
 *         //   ]
 *         // }
 *     })
 *
 */
let calcVolx = (() => {

    let KP = { //內建週期表(值為根數; 標籤以每根4hr寫定: '12hr'=3根、'1day'=6根), 實際週期表由resolvePeriods依opt.intervalSec(根數不變、標籤換算)或opt.kp決定
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6,
        '2day': 12,
        '4day': 24,
        '7day': 42,
        '15day': 90,
        '30day': 180,
    }

    //預設值
    let LONG_MULT_DEF = 4
    let VR_LAG_DEF = 6
    let VOV_LEN_DEF = 6
    let EPS_DEF = 1e-12

    //popStd, x於索引a至b(含)之母體標準差; 全部相同者回0(平均值之捨入不致留下微小之非零值)
    let popStd = (x, a, b) => {
        let m = b - a + 1
        let mn = Infinity
        let mx = -Infinity
        let s = 0
        for (let j = a; j <= b; j++) {
            let v = x[j]
            s += v
            if (v < mn) {
                mn = v
            }
            if (v > mx) {
                mx = v
            }
        }
        if (mn === mx) {
            return 0
        }
        let mean = s / m
        let q = 0
        for (let j = a; j <= b; j++) {
            let d = x[j] - mean
            q += d * d
        }
        return Math.sqrt(q / m)
    }

    let caVolx = (arr, q, len, o) => {

        //n
        let n = size(arr)

        //s0, 第一筆對應之輸入索引: 各欄所需最早一根之最大者
        //  rv、chop、downShare: i-len+1>=1(r、tr自索引1起); park、gk、rs: i-len+1>=0; jumpShare: i-len+1>=2(|r(j)||r(j-1)|自j=2起)
        //  rvRatio: i-len*longMult+1>=1; varRatio: i-len+1>=vrLag(lc(j-vrLag)); volOfVol: i-len+1>=vovLen(u(j)自j=vovLen起)
        //  逐欄之最小i依序為 len、len-1、len+1、len*longMult、len+vrLag-1、len+vovLen-1
        let s0 = Math.max(len, len - 1, len + 1, len * o.longMult, len + o.vrLag - 1, len + o.vovLen - 1)

        //check, 筆數不足
        if (n < s0 + 1) {
            return []
        }

        let kTime = 'time'
        let { lh, ll, lc, r, r2, pk, gk, rs: rsq, tr, bp, u } = q
        let eps = o.eps

        //lnv, 0.5*ln(max(x,eps))
        let lnv = (x) => 0.5 * Math.log(Math.max(x, eps))

        //rs
        let rs = []
        let lenLong = len * o.longMult
        for (let i = s0; i < n; i++) {

            let a = i - len + 1

            //視窗W(i,len)內之各和
            let sR2 = 0
            let sPk = 0
            let sGk = 0
            let sRs = 0
            let sTr = 0
            let sNeg = 0
            let sBp = 0
            let sDsq = 0
            let hi = -Infinity
            let lo = Infinity
            for (let j = a; j <= i; j++) {
                sR2 += r2[j]
                sPk += pk[j]
                sGk += gk[j]
                sRs += rsq[j]
                sTr += tr[j]
                if (r[j] < 0) {
                    sNeg += r2[j]
                }
                sBp += bp[j]
                let d = lc[j] - lc[j - o.vrLag]
                sDsq += d * d
                if (lh[j] > hi) {
                    hi = lh[j]
                }
                if (ll[j] < lo) {
                    lo = ll[j]
                }
            }
            let mR2 = sR2 / len

            //長視窗W(i,len*longMult)之r²平均
            let sLong = 0
            for (let j = i - lenLong + 1; j <= i; j++) {
                sLong += r2[j]
            }

            //rv
            let rv = lnv(mR2)

            //chop
            let range = hi - lo
            let chop = 0
            if (range > 0 && sTr > 0) {
                chop = Math.log10(sTr / range) / Math.log10(len)
            }

            rs.push({
                time: arr[i][kTime],
                rv,
                park: lnv(sPk / len),
                gk: lnv(sGk / len),
                rs: lnv(sRs / len),
                rvRatio: rv - lnv(sLong / lenLong),
                chop,
                downShare: sR2 > 0 ? sNeg / sR2 : 0.5,
                jumpShare: mR2 > 0 ? 1 - (Math.PI / 2) * (sBp / len) / mR2 : 0,
                varRatio: mR2 > 0 ? (sDsq / len) / (o.vrLag * mR2) : 1,
                volOfVol: popStd(u, a, i),
            })
        }
        // console.log('rs', rs)

        return rs
    }

    let caVolxs = (arr, opt = {}) => {

        //kp, 週期表(resolvePeriods: opt.intervalSec根數不變、標籤依根數×每根時長換算, 未給時同內建表; opt.kp直接採用; opt.intervalSec無效即拋)
        let kp = resolvePeriods(KP, opt)

        //check, 各期之值須為至少2之整數(chop除以log10(len); opt.kp之值為參數物件或小於2者於此拒絕)
        each(kp, (len) => {
            if (!(Number.isInteger(len) && len >= 2)) {
                throw new Error(`invalid opt.kp: must be an object of integers >= 2`)
            }
        })

        //longMult、vrLag、vovLen、eps, opt各鍵經getOptReader讀取(給了即檢測, 非預期之輸入視為未給而改用預設, opt.debug為true時警告); 檢測通過之數字字串轉為數值後使用
        let rd = getOptReader('w-data-trade calcVolx', opt)
        let isInt2 = (v) => iseint(v, { min: 2 })
        let longMult = Number(rd('longMult', LONG_MULT_DEF, isInt2, 'an integer >= 2', `${LONG_MULT_DEF}`))
        let vrLag = Number(rd('vrLag', VR_LAG_DEF, isInt2, 'an integer >= 2', `${VR_LAG_DEF}`))
        let vovLen = Number(rd('vovLen', VOV_LEN_DEF, isInt2, 'an integer >= 2', `${VOV_LEN_DEF}`))
        let eps = Number(rd('eps', EPS_DEF, (v) => isenum(v) && Number(v) > 0, 'a positive number', `${EPS_DEF}`))

        //n
        let n = size(arr)

        //check, 逐根檢核(任一根無效即拒), 並取各欄之對數
        let lo = new Array(n)
        let lh = new Array(n)
        let ll = new Array(n)
        let lc = new Array(n)
        let ks = [['Open', lo], ['High', lh], ['Low', ll], ['Close', lc]]
        for (let i = 0; i < n; i++) {
            let vs = []
            for (let [k, ar] of ks) {
                let v = get(arr[i], k)
                if (!isNumber(v) || !Number.isFinite(v) || !(v > 0)) {
                    throw new Error(`invalid arr: must have a positive finite Open, High, Low and Close in every element`)
                }
                vs.push(v)
                ar[i] = Math.log(v)
            }

            //check, 高低須涵蓋開收(自相矛盾之K線無法判讀: gk、rs之逐根量可為負, 平均不大於0時被eps下限取代而得極端值, 故收嚴為整批reject; 合法之K線其逐根量皆不小於0)
            let [o, h, l, c] = vs
            if (!(l <= o && l <= c && h >= o && h >= c)) {
                throw new Error(`invalid arr: must have Low <= Open, Close <= High in every element`)
            }
        }

        //逐根之量(索引不足者不用, 填0)
        let r = new Array(n).fill(0)
        let r2 = new Array(n).fill(0)
        let pk = new Array(n).fill(0)
        let gk = new Array(n).fill(0)
        let rsq = new Array(n).fill(0)
        let tr = new Array(n).fill(0)
        let bp = new Array(n).fill(0)
        let k2 = 2 * Math.LN2 - 1
        for (let i = 0; i < n; i++) {
            let hl = lh[i] - ll[i]
            let co = lc[i] - lo[i]
            pk[i] = hl * hl / (4 * Math.LN2)
            gk[i] = 0.5 * hl * hl - k2 * co * co
            rsq[i] = (lh[i] - lc[i]) * (lh[i] - lo[i]) + (ll[i] - lc[i]) * (ll[i] - lo[i])
            if (i >= 1) {
                r[i] = lc[i] - lc[i - 1]
                r2[i] = r[i] * r[i]
                tr[i] = Math.max(lh[i], lc[i - 1]) - Math.min(ll[i], lc[i - 1])
            }
            if (i >= 2) {
                bp[i] = Math.abs(r[i]) * Math.abs(r[i - 1])
            }
        }

        //u, u(j)=lnv(r²於W(j,vovLen)之平均), 自索引vovLen起(各期共用)
        let u = new Array(n).fill(0)
        for (let j = vovLen; j < n; j++) {
            let s = 0
            for (let k = j - vovLen + 1; k <= j; k++) {
                s += r2[k]
            }
            u[j] = 0.5 * Math.log(Math.max(s / vovLen, eps))
        }

        //q, 逐根之量; o, 選項
        let q = { lh, ll, lc, r, r2, pk, gk, rs: rsq, tr, bp, u }
        let o = { longMult, vrLag, vovLen, eps }

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caVolx
            let rs = caVolx(arr, q, len, o)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })
            // console.log('rrs', rrs)

        })

        return rrs
    }

    let calcVolx = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   ...
        // ]

        //caVolxs
        let rs = caVolxs(arr, opt)

        return rs
    }

    return calcVolx
})()


export default calcVolx
