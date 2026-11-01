package com.example.networkscanner

data class PortResult(
    val ip: String,
    val port: Int,
    val service: String,
    val open: Boolean
)

data class HostResult(
    val ip: String,
    val reachable: Boolean,
    val openPorts: List<PortResult>
)

enum class ScanState {
    IDLE,
    SCANNING_HOSTS,
    SCANNING_PORTS,
    DONE,
    ERROR
}

data class ScanProgress(
    val state: ScanState,
    val currentIp: String = "",
    val currentPort: Int = 0,
    val hostsFound: Int = 0,
    val totalHosts: Int = 0
)
