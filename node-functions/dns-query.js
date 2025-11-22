import dnsPacket from 'dns-packet'
import * as ipaddr from 'ipaddr.js'

const dohUrl = new URL('https://cloudflare-dns.com/dns-query')
const dohOrigin = dohUrl.origin
const dohHost = dohUrl.host

const cname = 'cf.100172.xyz'

const fetchCloudflareDns = async context => {
    const request = context.request
    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.set('host', dohHost)
    
    proxyHeaders.delete('x-forwarded-host')
    proxyHeaders.delete('x-forwarded-proto')
    proxyHeaders.delete('x-forwarded-port')
    proxyHeaders.delete('x-forwarded-for')
    
    const response = await fetch( request.url.replace('doh.100172.xyz',dohHost), {
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

const fetchAnswers = async () => {
    const response = await fetch(dohUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/dns-message'
        },
        body: dnsPacket.encode({
            type: 'query',
            id: 1,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [{
                type: 'A',
                name: cname
            }]
        })
    })
    
    const bytes = await response.bytes()
    const buffer = Buffer.from(bytes)
    
    const packet = dnsPacket.decode(buffer)
    return packet.answers
}

const proxyRequest = async context => {
    
    const promises = []
    promises.push(fetchCloudflareDns(context))
    promises.push(fetchCloudflareIpv4())
    const [dnsResult, ipv4Result] = await Promise.all(promises)
    
    const response = new Response(dnsResult.buffer, {
        status: dnsResult.response.status,
        statusText: dnsResult.response.statusText,
        headers: dnsResult.response.headers
    })
    
    try {
        const packet = dnsPacket.decode(dnsResult.buffer)
        
        console.log('packet',packet)
        if (packet.questions == null) {
            return response
        }
        
        if (packet.questions.length !== 1) {
            return response
        }
        
        if (packet.answers == null) {
            return response
        }
        const question = packet.questions[0]
        
        if (question.type !== 'A') {
            return response
        }
        if (question.class !== 'IN') {
            return response
        }
        if (question.name === cname) {
            return response
        }
        
        let cloudflare = false
        
        for (let i = 0; i < packet.answers.length; i++) {
            const answer = packet.answers[i]
            if (answer.type === 'A') {
                const ipv4 = answer.data
                const addr =   ipaddr.parse(ipv4)
                for (let cidr of ipv4Result.cidrList) {
                    if (addr.match(ipaddr.parseCIDR(cidr))){
                        cloudflare = true
                    }
                }
                
            }
        }
        
        if (cloudflare) {
            const answers = await fetchAnswers()
            if (answers == null || answers.length === 0){
                return response
            }
            
            packet.answers = answers
            for (let i = 0; i < packet.answers.length; i++) {
                const answer = packet.answers[i]
                if (answer.type === 'CNAME' && answer.name === cname) {
                    answer.name = question.name
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
    
    return response
    
}

export function onRequestGet(context) {
    return proxyRequest(context)
}

export function onRequestPost(context) {
    return proxyRequest(context)
}