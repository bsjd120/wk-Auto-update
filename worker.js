// <!--GAMFC-->version based on commit 43fad05dcdae3b723c53c226f8181fc5bd47223e, time is 2023-06-22 15:20:05 UTC<!--GAMFC-END-->.
// @ts-ignore
import { connect } from 'cloudflare:sockets';

// Generates a UUID for user identification
let userID = 'c45e32a1-806e-4fe6-a616-4c579b215bb7';

// Proxy IP for Cloudflare, does not affect connection speed
let proxyIP = 'cdn.xn--b6gac.eu.org''; // Options: 'cdn.xn--b6gac.eu.org', 'cdn-all.xn--b6gac.eu.org', 'edgetunnel.anycast.eu.org'

// Subscription URL for configuration generation
let sub = 'sub.cmliussss.workers.dev'; // Built-in subscription generator, can be self-hosted: https://github.com/cmliu/WorkerVless2sub
let subconverter = 'api.v1.mk'; // Clash subscription converter backend, supports self-hosted: https://github.com/bulianglin/psub
let subconfig = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini"; // Subscription configuration file

// SOCKS5 address, format: user:pass@host:port or host:port
let socks5Address = '';
let reverseProxyIP = 'false';
if (!isValidUUID(userID)) {
    throw new Error('UUID is not valid');
}

let parsedSocks5Address = {};
let enableSocks = false;

// Fake UUID and hostname for configuration service
let fakeUserID = generateUUID();
let fakeHostName = generateRandomString();

// Main request handler for Cloudflare Worker
export default {
    /**
     * Handles incoming HTTP and WebSocket requests
     * @param {import("@cloudflare/workers-types").Request} request
     * @param {{UUID: string, PROXYIP: string}} env
     * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
     * @returns {Promise<Response>}
     */
    async fetch(request, env, ctx) {
        try {
            const userAgent = request.headers.get('User-Agent').toLowerCase();
            userID = env.UUID || userID;
            proxyIP = env.PROXYIP || proxyIP;
            socks5Address = env.SOCKS5 || socks5Address;
            sub = env.SUB || sub;
            subconverter = env.SUBAPI || subconverter;
            subconfig = env.SUBCONFIG || subconfig;
            if (socks5Address) {
                reverseProxyIP = env.RPROXYIP || 'false';
                try {
                    parsedSocks5Address = socks5AddressParser(socks5Address);
                    enableSocks = true;
                } catch (err) {
                    /** @type {Error} */ let e = err;
                    console.log(e.toString());
                    enableSocks = false;
                }
            } else {
                reverseProxyIP = env.RPROXYIP || !proxyIP ? 'true' : 'false';
            }
            const upgradeHeader = request.headers.get('Upgrade');
            const url = new URL(request.url);
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                switch (url.pathname) {
                    case '/':
                        return new Response(JSON.stringify(request.cf), { status: 200 });
                    case `/${userID}`: {
                        const vlessConfig = await getVLESSConfig(userID, request.headers.get('Host'), sub, userAgent, reverseProxyIP);
                        const now = Date.now();
                        const timestamp = Math.floor(now / 1000);
                        const today = new Date(now);
                        today.setHours(0, 0, 0, 0);
                        if (userAgent && userAgent.includes('mozilla')) {
                            return new Response(`${vlessConfig}`, {
                                status: 200,
                                headers: {
                                    "Content-Type": "text/plain;charset=utf-8",
                                }
                            });
                        } else {
                            return new Response(`${vlessConfig}`, {
                                status: 200,
                                headers: {
                                    "Content-Disposition": "attachment; filename=edgetunnel; filename*=utf-8''edgetunnel",
                                    "Content-Type": "text/plain;charset=utf-8",
                                    "Profile-Update-Interval":、直"6",
                                    "Subscription-Userinfo": `upload=0; download=${Math.floor(((now - today.getTime())/86400000) * 24 * 1099511627776)}; total=${24 * 1099511627776}; expire=${timestamp}`,
                                }
                            });
                        }
                    }
                    default:
                        return new Response('Not found', { status: 404 });
                }
            } else {
                if (new RegExp('/proxyip=', 'i').test(url.pathname)) proxyIP = url.pathname.split("=")[1];
                else if (new RegExp('/proxyip.', 'i').test(url.pathname)) proxyIP = url.pathname.split("/proxyip.")[1];
                else if (!proxyIP || proxyIP == '') proxyIP = 'proxyip.fxxk.dedyn.io';
                return await vlessOverWSHandler(request);
            }
        } catch (err) {
            /** @type {Error} */ let e = err;
            return new Response(e.toString());
        }
    },
};

// Handles VLESS over WebSocket connections
async function vlessOverWSHandler(request) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.accept();
    let address = '';
    let portWithRandomLog = '';
    const log = (info, event) => {
        console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
    };
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);
    let remoteSocketWapper = { value: null };
    let isDns = false;

    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (isDns) {
                return await handleDNSQuery(chunk, webSocket, null, log);
            }
            if (remoteSocketWapper.value) {
                const writer = remoteSocketWapper.value.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }
            const {
                hasError,
                message,
                addressType,
                portRemote = 443,
                addressRemote = '',
                rawDataIndex,
                vlessVersion = new Uint8Array([0, 0]),
                isUDP,
            } = processVlessHeader(chunk, userID);
            address = addressRemote;
            portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '}`;
            if (hasError) {
                throw new Error(message);
                return;
            }
            if (isUDP) {
                if (portRemote === 53) {
                    isDns = true;
                } else {
                    throw new Error('UDP proxy only enable for DNS which is port 53');
                    return;
                }
            }
            const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
            const rawClientData = chunk.slice(rawDataIndex);
            if (isDns) {
                return handleDNSQuery(rawClientData, webSocket, vlessResponseHeader, log);
            }
            handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log);
        },
        close() {
            log(`readableWebSocketStream is closed`);
        },
        abort(reason) {
            log(`readableWebSocketStream is aborted`, JSON.stringify(reason));
        },
    })).catch((err) => {
        log('readableWebSocketStream pipeTo error', err);
    });

    return new Response(null, {
        status: 101,
        webSocket: client,
    });
}

// Manages outbound TCP connections
async function handleTCPOutBound(remoteSocket, addressType, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log) {
    async function connectAndWrite(address, port, socks = false) {
        const tcpSocket = socks ? await socks5Connect(addressType, address, port, log)
            : connect({
                hostname: address,
                port: port,
            });
        remoteSocket.value = tcpSocket;
        log(`connected to ${address}:${port}`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        return tcpSocket;
    }

    async function retry() {
        let tcpSocket;
        if (enableSocks) {
            tcpSocket = await connectAndWrite(addressRemote, portRemote, true);
        } else {
            tcpSocket = await connectAndWrite(proxyIP || addressRemote, portRemote);
        }
        tcpSocket.closed.catch(error => {
            console.log('retry tcpSocket closed error', error);
        }).finally(() => {
            safeCloseWebSocket(webSocket);
        });
        remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, null, log);
    }

    let tcpSocket = await connectAndWrite(addressRemote, portRemote);

    remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log);
}

// Creates a readable stream from WebSocket
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
    let readableStreamCancel = false;
    const stream = new ReadableStream({
        start(controller) {
            webSocketServer.addEventListener('message', (event) => {
                if (readableStreamCancel) return;
                const message = event.data;
                controller.enqueue(message);
            });
            webSocketServer.addEventListener('close', () => {
                safeCloseWebSocket(webSocketServer);
                if (readableStreamCancel) return;
                controller.close();
            });
            webSocketServer.addEventListener('error', (err) => {
                log('webSocketServer has error');
                controller.error(err);
            });
            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) {
                controller.error(error);
            } else if (earlyData) {
                controller.enqueue(earlyData);
            }
        },
        pull(controller) {},
        cancel(reason) {
            if (readableStreamCancel) return;
            log(`ReadableStream was canceled, due to ${reason}`);
            readableStreamCancel = true;
            safeCloseWebSocket(webSocketServer);
        }
    });
    return stream;
}

// Processes VLESS protocol header
function processVlessHeader(vlessBuffer, userID) {
    if (vlessBuffer.byteLength < 24) {
        return {
            hasError: true,
            message: 'invalid data',
        };
    }
    const version = new Uint8Array(vlessBuffer.slice(0, 1));
    let isValidUser = false;
    let isUDP = false;
    if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) === userID) {
        isValidUser = true;
    }
    if (!isValidUser) {
        return {
            hasError: true,
            message: 'invalid user',
        };
    }
    const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
    const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
    if (command === 1) {
    } else if (command === 2) {
        isUDP = true;
    } else {
        return {
            hasError: true,
            message: `command ${command} is not supported, command 01-tcp, 02-udp, 03-mux`,
        };
    }
    const portIndex = 18 + optLength + 1;
    const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
    const portRemote = new DataView(portBuffer).getUint16(0);
    let addressIndex = portIndex + 2;
    const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));
    const addressType = addressBuffer[0];
    let addressLength = 0;
    let addressValueIndex = addressIndex + 1;
    let addressValue = '';
    switch (addressType) {
        case 1:
            addressLength = 4;
            addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
            break;
        case 2:
            addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 3:
            addressLength = 16;
            const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(':');
            break;
        default:
            return {
                hasError: true,
                message: `invalid addressType is ${addressType}`,
            };
    }
    if (!addressValue) {
        return {
            hasError: true,
            message: `addressValue is empty, addressType is ${addressType}`,
        };
    }
    return {
        hasError: false,
        addressRemote: addressValue,
        addressType,
        portRemote,
        rawDataIndex: addressValueIndex + addressLength,
        vlessVersion: version,
        isUDP,
    };
}

// Forwards data from remote socket to WebSocket
async function remoteSocketToWS(remoteSocket, webSocket, vlessResponseHeader, retry, log) {
    let remoteChunkCount = 0;
    let vlessHeader = vlessResponseHeader;
    let hasIncomingData = false;
    await remoteSocket.readable.pipeTo(new WritableStream({
        start() {},
        async write(chunk, controller) {
            hasIncomingData = true;
            if (webSocket.readyState !== WS_READY_STATE_OPEN) {
                controller.error('webSocket.readyState is not open, maybe closed');
            }
            if (vlessHeader) {
                webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
                vlessHeader = null;
            } else {
                webSocket.send(chunk);
            }
        },
        close() {
            log(`remoteConnection.readable is closed with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
            console.error(`remoteConnection.readable aborted`, reason);
        },
    })).catch((error) => {
        console.error(`remoteSocketToWS has exception`, error.stack || error);
        safeCloseWebSocket(webSocket);
    });
    if (hasIncomingData === false && retry) {
        log(`retry`);
        retry();
    }
}

// Converts base64 string to ArrayBuffer
function base64ToArrayBuffer(base64Str) {
    if (!base64Str) {
        return { error: null };
    }
    try {
        base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
        const decode = atob(base64Str);
        const arrayBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arrayBuffer.buffer, error: null };
    } catch (error) {
        return { error };
    }
}

// Validates UUID format
function isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

// Safely closes WebSocket connection
function safeCloseWebSocket(socket) {
    try {
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
            socket.close();
        }
    } catch (error) {
        console.error('safeCloseWebSocket error', error);
    }
}

const byteToHex = [];
for (let i = 0; i < 256; ++i) {
    byteToHex.push((i + 256).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
    return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

function stringify(arr, offset = 0) {
    const uuid = unsafeStringify(arr, offset);
    if (!isValidUUID(uuid)) {
        throw TypeError("Stringified UUID is invalid");
    }
    return uuid;
}

// Handles DNS queries over UDP
async function handleDNSQuery(udpChunk, webSocket, vlessResponseHeader, log) {
    try {
        const dnsServer = '8.8.4.4';
        const dnsPort = 53;
        let vlessHeader = vlessResponseHeader;
        const tcpSocket = connect({
            hostname: dnsServer,
            port: dnsPort,
        });
        log(`connected to ${dnsServer}:${dnsPort}`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(udpChunk);
        writer.releaseLock();
        await tcpSocket.readable.pipeTo(new WritableStream({
            async write(chunk) {
                if (webSocket.readyState === WS_READY_STATE_OPEN) {
                    if (vlessHeader) {
                        webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
                        vlessHeader = null;
                    } else {
                        webSocket.send(chunk);
                    }
                }
            },
            close() {
                log(`dns server(${dnsServer}) tcp is closed`);
            },
            abort(reason) {
                console.error(`dns server(${dnsServer}) tcp is aborted`, reason);
            },
        }));
    } catch (error) {
        console.error(`handleDNSQuery has exception, error: ${error.message}`);
    }
}

// Establishes SOCKS5 connection
async function socks5Connect(addressType, addressRemote, portRemote, log) {
    const { username, password, hostname, port } = parsedSocks5Address;
    const socket = connect({
        hostname,
        port,
    });
    const socksGreeting = new Uint8Array([5, 2, 0, 2]);
    const writer = socket.writable.getWriter();
    await writer.write(socksGreeting);
    log('sent socks greeting');
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    let res = (await reader.read()).value;
    if (res[0] !== 0x05) {
        log(`socks server version error: ${res[0]} expected: 5`);
        return;
    }
    if (res[1] === 0xff) {
        log("no acceptable methods");
        return;
    }
    if (res[1] === 0x02) {
        log("socks server needs auth");
        if (!username || !password) {
            log("please provide username/password");
            return;
        }
        const authRequest = new Uint8Array([
            1,
            username.length,
            ...encoder.encode(username),
            password.length,
            ...encoder.encode(password)
        ]);
        await writer.write(authRequest);
        res = (await reader.read()).value;
        if (res[0] !== 0x01 || res[1] !== 0x00) {
            log("failed to auth socks server");
            return;
        }
    }
    let DSTADDR;
    switch (addressType) {
        case 1:
            DSTADDR = new Uint8Array([1, ...addressRemote.split('.').map(Number)]);
            break;
        case 2:
            DSTADDR = new Uint8Array([3, addressRemote.length, ...encoder.encode(addressRemote)]);
            break;
        case 3:
            DSTADDR = new Uint8Array([4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]);
            break;
        default:
            log(`invalid addressType is ${addressType}`);
            return;
    }
    const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
    await writer.write(socksRequest);
    log('sent socks request');
    res = (await reader.read()).value;
    if (res[1] === 0x00) {
        log("socks connection opened");
    } else {
        log("failed to open socks connection");
        return;
    }
    writer.releaseLock();
    reader.releaseLock();
    return socket;
}

// Parses SOCKS5 address format
function socks5AddressParser(address) {
    let [latter, former] = address.split("@").reverse();
    let username, password, hostname, port;
    if (former) {
        const formers = former.split(":");
        if (formers.length !== 2) {
            throw new Error('Invalid SOCKS address format');
        }
        [username, password] = formers;
    }
    const latters = latter.split(":");
    port = Number(latters.pop());
    if (isNaN(port)) {
        throw new Error('Invalid SOCKS address format');
    }
    hostname = latters.join(":");
    const regex = /^\[.*\]$/;
    if (hostname.includes(":") && !regex.test(hostname)) {
        throw new Error('Invalid SOCKS address format');
    }
    return {
        username,
        password,
        hostname,
        port,
    };
}

// Reverts fake UUID and hostname in content
function revertFakeInfo(content, userID, hostName, isBase64) {
    if (isBase64) content = atob(content);
    content = content.replace(new RegExp(fakeUserID, 'g'), userID).replace(new RegExp(fakeHostName, 'g'), hostName);
    if (isBase64) content = btoa(content);
    return content;
}

// Generates a random number for hostname creation
function generateRandomNumber() {
    let minNum = 100000;
    let maxNum = 999999;
    return Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum;
}

// Generates a random string for hostname
function generateRandomString() {
    let minLength = 2;
    let maxLength = 3;
    let length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
    let characters = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for let i = 0; i < length; i++) {
        result += characters[Math.floor(Math.random() * characters.length)];
    }
    return result;
}

// Generates a random UUID
function generateUUID() {
    let uuid = '';
    for (let i = 0; i < 32; i++) {
        let num = Math.floor(Math.random() * 16);
        if (num < 10) {
            uuid += num;
        } else {
            uuid += String.fromCharCode(num + 55);
        }
    }
    return uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5').toLowerCase();
}

// Generates VLESS configuration based on user agent
async function getVLESSConfig(userID, hostName, sub, userAgent, reverseProxyIP) {
    if (!sub || sub === '') {
        const vlessMain = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;
        return `
        ################################################################
        v2ray
        ---------------------------------------------------------------
        ${vlessMain}
        ---------------------------------------------------------------
        ################################################################
        clash-meta
        ---------------------------------------------------------------
        - type: vless
          name: ${hostName}
          server: ${hostName}
          port: 443
          uuid: ${userID}
          network: ws
          tls: true
          udp: false
          sni: ${hostName}
          client-fingerprint: chrome
          ws-opts:
            path: "/?ed=2048"
            headers:
              host: ${hostName}
        ---------------------------------------------------------------
        ################################################################
        `;
    } else if (sub && userAgent.includes('mozilla') && !userAgent.includes('linux x86')) {
        const vlessMain = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;
        return `
        ################################################################
        Subscribe / subscription URL, supports Base64, clash-meta, sing-box formats, maintained by ${sub}, auto-fetches ProxyIP: ${reverseProxyIP}.
        ---------------------------------------------------------------
        https://${hostName}/${userID}
        ---------------------------------------------------------------
        ################################################################
        v2ray
        ---------------------------------------------------------------
        ${vlessMain}
        ---------------------------------------------------------------
        ################################################################
        clash-meta
        ---------------------------------------------------------------
        - type: vless
          name: ${hostName}
          server: ${hostName}
          port: 443
          uuid: ${userID}
          network: ws
          tls: true
          udp: false
          sni: ${hostName}
          client-fingerprint: chrome
          ws-opts:
            path: "/?ed=2048"
            headers:
              host: ${hostName}
        ---------------------------------------------------------------
        ################################################################
        Telegram discussion group
        https://t.me/CMLiussss
        ---------------------------------------------------------------
        ################################################################
        GitHub project address
        https://github.com/cmliu/edgetunnel
        ---------------------------------------------------------------
        ################################################################
        `;
    } else {
        if (typeof fetch != 'function') {
            return 'Error: fetch is not available in this environment.';
        }
        if (hostName.includes(".workers.dev") || hostName.includes(".pages.dev")) {
            fakeHostName = `${fakeHostName}.${generateRandomString()}${generateRandomNumber()}.workers.dev`;
        } else {
            fakeHostName = `${fakeHostName}.${generateRandomNumber()}.xyz`;
        }
        let content = "";
        let url = "";
        let is پایه64 = false;
        if (userAgent.includes('clash')) {
            url = `https://${subconverter}/sub?target=clash&url=https%3A%2F%2F${sub}%2Fsub%3Fhost%3D${fakeHostName}%26uuid%3D${fakeUserID}%26edgetunnel%3Dcmliu%26proxyip%3D${reverseProxyIP}&insert=false&config=${encodeURIComponent(subconfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
        } else if (userAgent.includes('sing-box') || userAgent.includes('singbox')) {
            url = `https://${subconverter}/sub?target=singbox&url=https%3A%2F%2F${sub}%2Fsub%3Fhost%3D${fakeHostName}%26uuid%3D${fakeUserID}%26edgetunnel%3Dcmliu%26proxyip%3D${reverseProxyIP}&insert=false&config=${encodeURIComponent(subconfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
        } else {
            url = `https://${sub}/sub?host=${fakeHostName}&uuid=${fakeUserID}&edgetunnel=cmliu&proxyip=${reverseProxyIP}`;
            isBase64 = true;
        }
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CF-Workers-edgetunnel/cmliu'
                }
            });
            content = await response.text();
            return revertFakeInfo(content, userID, hostName, isBase64);
        } catch (error) {
            console.error('Error fetching content:', error);
            return `Error fetching content: ${error.message}`;
        }
    }
}
