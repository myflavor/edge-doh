import dnsPacket from 'dns-packet'
import * as ipaddr from 'ipaddr.js'

const dohUrl = new URL('https://cloudflare-dns.com/dns-query')
const dohOrigin = dohUrl.origin
const dohHost = dohUrl.host

const fetchCloudflareDns = async context => {
    const request = context.request
    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.set('host', dohHost)
    
    proxyHeaders.delete('x-forwarded-host')
    proxyHeaders.delete('x-forwarded-proto')
    proxyHeaders.delete('x-forwarded-port')
    proxyHeaders.delete('x-forwarded-for')
    
    const response = await fetch(dohOrigin + request.url, {
        method: request.method,
        headers: proxyHeaders,
        body: request.body
    })
    
    const bytes = await response.bytes()
    const buffer = Buffer.from(bytes)
    
    return {response, buffer}
}

const fetchCloudflareIpv4 = async () => {
    const response = await fetch('https://www.cloudflare.com/ips-v4')
    const text = await response.text()
    const cidrList = text.split('\n')
    return {response, cidrList}
}

const proxyRequest = async context => {
    
    const promises = []
    promises.push(fetchCloudflareDns(context))
    promises.push(fetchCloudflareIpv4())
    const [dnsResult, ipv4Result] = await Promise.all(promises)
    
    try {
        const packet = dnsPacket.decode(dnsResult.buffer)
        
        console.log('packet',packet)
        
        if (packet.answers){
            for (let i = 0; i < packet.answers.length; i++) {
                const answer = packet.answers[i]
                if (answer.type === 'A') {
                    const ipv4 = answer.data
                    
                    const addr =   ipaddr.parse(ipv4)
                    for (let cidr of ipv4Result.cidrList) {
                        if (addr.match(ipaddr.parseCIDR(cidr))){
                            answer.type = 'CNAME'
                            answer.data = 'cf.100172.xyz'
                            break
                        }
                    }
                    
                }
            }
            const proxyHeaders = new Headers(dnsResult.response.headers)
            proxyHeaders.delete('content-length')
            
           return new Response(dnsPacket.encode(packet), {
            status: dnsResult.response.status,
            statusText: dnsResult.response.statusText,
            headers: proxyHeaders
        })
        }
        
        
    } catch (error) {
        console.log('dns解析出错', error)
    }
    
    return new Response(dnsResult.buffer, {
        status: dnsResult.response.status,
        statusText: dnsResult.response.statusText,
        headers: dnsResult.response.headers
    })
    
}

export function onRequestGet(context) {
    return proxyRequest(context)
}

export function onRequestPost(context) {
    return proxyRequest(context)
}