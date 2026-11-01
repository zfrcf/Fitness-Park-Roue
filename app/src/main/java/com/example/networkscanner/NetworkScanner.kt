package com.example.networkscanner

import android.content.Context
import android.net.wifi.WifiManager
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class NetworkScanner(private val context: Context) {

    companion object {
        // Ports courants à scanner
        val PORTS_TO_SCAN = listOf(
            21 to "FTP",
            22 to "SSH",
            23 to "Telnet",
            25 to "SMTP",
            53 to "DNS",
            80 to "HTTP",
            110 to "POP3",
            143 to "IMAP",
            443 to "HTTPS",
            445 to "SMB",
            465 to "SMTPS",
            587 to "Submission",
            993 to "IMAPS",
            995 to "POP3S",
            1433 to "MSSQL",
            1521 to "Oracle",
            3306 to "MySQL",
            3389 to "RDP",
            5432 to "PostgreSQL",
            5900 to "VNC",
            6379 to "Redis",
            8080 to "HTTP-Alt",
            8081 to "HTTP-Alt2",
            8443 to "HTTPS-Alt",
            8888 to "HTTP-Proxy",
            9090 to "Web-Admin",
            27017 to "MongoDB"
        )
    }

    private val executor = Executors.newFixedThreadPool(50)

    fun getLocalNetworkInfo(): Pair<String, String> {
        // Récupère l'IP locale et le préfixe réseau
        var localIp = ""
        var networkPrefix = "192.168.1"

        try {
            for (intf : NetworkInterface.getNetworkInterfaces()) {
                if (intf.name.startsWith("wlan") || intf.name.startsWith("eth")) {
                    for (addr : intf.inetAddresses) {
                        if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                            localIp = addr.hostAddress ?: ""
                            if (localIp.isNotEmpty()) {
                                val parts = localIp.split(".")
                                networkPrefix = "${parts[0]}.${parts[1]}.${parts[2]}"
                                break
                            }
                        }
                    }
                    if (localIp.isNotEmpty()) break
                }
            }
        } catch (e: Exception) {
            // fallback
        }

        if (localIp.isEmpty()) {
            localIp = "192.168.1.1"
        }

        return Pair(localIp, networkPrefix)
    }

    fun scanNetwork(
        onProgress: (ScanProgress) -> Unit,
        onResult: (List<HostResult>) -> Unit,
        onError: (String) -> Unit
    ) {
        Thread {
            try {
                val (localIp, prefix) = getLocalNetworkInfo()
                val hostCount = 254 // scanne .1 à .254

                onProgress(ScanProgress(ScanState.SCANNING_HOSTS, totalHosts = hostCount))

                // Phase 1 : trouver les hôtes actifs
                val activeHosts = mutableListOf<String>()
                val hostLatch = CountDownLatch(hostCount)
                val hostLock = Any()
                val foundCount = AtomicInteger(0)

                for (i in 1..hostCount) {
                    val ip = "$prefix.$i"
                    executor.execute {
                        try {
                            val reachable = isHostAlive(ip)
                            if (reachable) {
                                synchronized(hostLock) {
                                    activeHosts.add(ip)
                                    val count = foundCount.incrementAndGet()
                                    onProgress(ScanProgress(
                                        ScanState.SCANNING_HOSTS,
                                        currentIp = ip,
                                        hostsFound = count,
                                        totalHosts = hostCount
                                    ))
                                }
                            }
                        } finally {
                            hostLatch.countDown()
                        }
                    }
                }

                hostLatch.await(30, TimeUnit.SECONDS)

                // Phase 2 : scanner les ports de chaque hôte actif
                onProgress(ScanProgress(
                    ScanState.SCANNING_PORTS,
                    hostsFound = activeHosts.size,
                    totalHosts = hostCount
                ))

                val results = mutableListOf<HostResult>()
                val portLatch = CountDownLatch(activeHosts.size)
                val portLock = Any()
                val portIndex = AtomicInteger(0)

                for (ip in activeHosts) {
                    executor.execute {
                        try {
                            val openPorts = scanPorts(ip, onProgress, portIndex, activeHosts.size)
                            val result = HostResult(ip, true, openPorts)
                            synchronized(portLock) {
                                results.add(result)
                                onProgress(ScanProgress(
                                    ScanState.SCANNING_PORTS,
                                    hostsFound = portIndex.get(),
                                    totalHosts = activeHosts.size
                                ))
                            }
                        } finally {
                            portLatch.countDown()
                        }
                    }
                }

                portLatch.await(60, TimeUnit.SECONDS)

                // Trier les résultats
                val sorted = results.sortedBy { it.ip }
                onProgress(ScanProgress(ScanState.DONE, hostsFound = sorted.size))
                onResult(sorted)

            } catch (e: Exception) {
                onError(e.message ?: "Erreur inconnue")
            }
        }.start()
    }

    private fun isHostAlive(ip: String): Boolean {
        // Méthode 1 : TCP connect sur port 443 (souvent ouvert)
        // Méthode 2 : TCP connect sur port 80
        // Méthode 3 : Ping (pas toujours disponible sur Android)
        return try {
            val socket = Socket()
            socket.connect(java.net.InetSocketAddress(ip, 443), 500)
            socket.close()
            true
        } catch (e: Exception) {
            try {
                val socket = Socket()
                socket.connect(java.net.InetSocketAddress(ip, 80), 500)
                socket.close()
                true
            } catch (e2: Exception) {
                try {
                    val addr = InetAddress.getByName(ip)
                    addr.isReachable(500)
                } catch (e3: Exception) {
                    false
                }
            }
        }
    }

    private fun scanPorts(
        ip: String,
        onProgress: (ScanProgress) -> Unit,
        portIndex: AtomicInteger,
        totalHosts: Int
    ): List<PortResult> {
        val openPorts = mutableListOf<PortResult>()
        val portLatch = CountDownLatch(PORTS_TO_SCAN.size)
        val portLock = Any()

        for ((port, service) in PORTS_TO_SCAN) {
            executor.execute {
                try {
                    val isOpen = isPortOpen(ip, port)
                    if (isOpen) {
                        synchronized(portLock) {
                            openPorts.add(PortResult(ip, port, service, true))
                        }
                    }
                } finally {
                    portLatch.countDown()
                }
            }
        }

        portLatch.await(15, TimeUnit.SECONDS)
        portIndex.incrementAndGet()

        return openPorts.sortedBy { it.port }
    }

    private fun isPortOpen(ip: String, port: Int): Boolean {
        return try {
            val socket = Socket()
            socket.connect(java.net.InetSocketAddress(ip, port), 400)
            socket.close()
            true
        } catch (e: SocketTimeoutException) {
            false
        } catch (e: Exception) {
            false
        }
    }

    fun shutdown() {
        executor.shutdownNow()
    }
}
