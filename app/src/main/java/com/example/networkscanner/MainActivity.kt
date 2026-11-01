package com.example.networkscanner

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*

class MainActivity : ComponentActivity() {

    private val job = SupervisorJob()
    private val mainScope = CoroutineScope(Dispatchers.Main + job)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme()
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF0D1117)
                ) {
                    NetworkScannerScreen()
                }
            }
        }
    }

    @Composable
    fun NetworkScannerScreen() {
        val context = LocalContext.current
        var scanState by remember { mutableStateOf(ScanState.IDLE) }
        var progress by remember { mutableStateOf(ScanProgress(ScanState.IDLE)) }
        var results by remember { mutableStateOf<List<HostResult>>(emptyList()) }
        var errorMessage by remember { mutableStateOf<String?>(null) }
        var localIp by remember { mutableStateOf("") }
        var networkPrefix by remember { mutableStateOf("") }
        var scanner by remember { mutableStateOf<NetworkScanner?>(null) }
        var expandedHost by remember { mutableStateOf<String?>(null) }

        LaunchedEffect(Unit) {
            withContext(Dispatchers.IO) {
                val ns = NetworkScanner(context)
                val (ip, prefix) = ns.getLocalNetworkInfo()
                localIp = ip
                networkPrefix = prefix
                scanner = ns
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Filled.Lan,
                    contentDescription = null,
                    tint = Color(0xFF58A6FF),
                    modifier = Modifier.size(28.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        "Network Scanner",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    if (localIp.isNotEmpty()) {
                        Text(
                            "Réseau : $networkPrefix.0/24  |  IP : $localIp",
                            fontSize = 12.sp,
                            color = Color(0xFF8B949E),
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Bouton scan
            Button(
                onClick = {
                    errorMessage = null
                    results = emptyList()
                    expandedHost = null
                    val ns = NetworkScanner(context)
                    scanner = ns
                    mainScope.launch {
                        ns.scanNetwork(
                            onProgress = { p ->
                                progress = p
                                scanState = p.state
                            },
                            onResult = { r ->
                                results = r
                                scanState = ScanState.DONE
                            },
                            onError = { msg ->
                                errorMessage = msg
                                scanState = ScanState.ERROR
                            }
                        )
                    }
                },
                enabled = scanState != ScanState.SCANNING_HOSTS && scanState != ScanState.SCANNING_PORTS,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (scanState == ScanState.SCANNING_HOSTS || scanState == ScanState.SCANNING_PORTS)
                        Color(0xFF30363D) else Color(0xFF238636)
                ),
                shape = RoundedCornerShape(8.dp)
            ) {
                if (scanState == ScanState.SCANNING_HOSTS || scanState == ScanState.SCANNING_PORTS) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color(0xFF58A6FF),
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        when (scanState) {
                            ScanState.SCANNING_HOSTS -> "Scan des hôtes..."
                            ScanState.SCANNING_PORTS -> "Scan des ports..."
                            else -> "Scan en cours..."
                        },
                        color = Color.White,
                        fontSize = 14.sp
                    )
                } else {
                    Icon(
                        Icons.Filled.Search,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Scanner le réseau", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Barre de progression
            when (scanState) {
                ScanState.SCANNING_HOSTS, ScanState.SCANNING_PORTS -> {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                when (scanState) {
                                    ScanState.SCANNING_HOSTS -> "Découverte des hôtes : ${progress.hostsFound}/${progress.totalHosts}"
                                    ScanState.SCANNING_PORTS -> "Scan ports : ${progress.hostsFound}/${progress.totalHosts} hôtes"
                                    else -> ""
                                },
                                fontSize = 13.sp,
                                color = Color(0xFF8B949E)
                            )
                            if (progress.currentIp.isNotEmpty()) {
                                Text(
                                    progress.currentIp,
                                    fontSize = 12.sp,
                                    color = Color(0xFF58A6FF),
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            progress = when {
                                scanState == ScanState.SCANNING_HOSTS && progress.totalHosts > 0 -> progress.hostsFound.toFloat() / progress.totalHosts
                                scanState == ScanState.SCANNING_PORTS && progress.totalHosts > 0 -> progress.hostsFound.toFloat() / progress.totalHosts
                                else -> 0f
                            },
                            color = Color(0xFF58A6FF),
                            trackColor = Color(0xFF30363D)
                        )
                    }
                }
                ScanState.ERROR -> {
                    if (errorMessage != null) {
                        Text(
                            "Erreur : $errorMessage",
                            color = Color(0xFFF85149),
                            fontSize = 13.sp,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Liste des résultats
            if (results.isNotEmpty()) {
                Text(
                    "${results.size} hôte(s) trouvé(s)",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color(0xFF8B949E)
                )
                Spacer(modifier = Modifier.height(8.dp))
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .weight(1f)
                ) {
                    items(results) { host ->
                        HostCard(
                            host = host,
                            isExpanded = (expandedHost == host.ip),
                            onToggle = { expandedHost = if (expandedHost == host.ip) null else host.ip }
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            } else if (scanState == ScanState.DONE) {
                Text(
                    "Aucun hôte avec ports ouverts trouvé",
                    fontSize = 14.sp,
                    color = Color(0xFF8B949E),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp)
                )
            } else if (scanState == ScanState.IDLE) {
                Text(
                    "Appuyez sur « Scanner le réseau » pour commencer",
                    fontSize = 14.sp,
                    color = Color(0xFF8B949E),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp)
                )
            }
        }
    }

    @Composable
    fun HostCard(
        host: HostResult,
        isExpanded: Boolean,
        onToggle: () -> Unit
    ) {
        val openPortCount = host.openPorts.size
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = Color(0xFF161B22),
                contentColor = Color.White
            ),
            shape = RoundedCornerShape(10.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                // En-tête hôte
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .fillMaxWidth()
                        .pointerInput(Unit) {
                            detectTapGestures(onTap = onToggle)
                        },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Filled.Computer,
                            contentDescription = null,
                            tint = Color(0xFF58A6FF),
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(crossAxisAlignment = androidx.compose.ui.Alignment.Start) {
                            Text(
                                host.ip,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                if (host.reachable) "En ligne" else "Hors ligne",
                                fontSize = 12.sp,
                                color = if (host.reachable) Color(0xFF3FB950) else Color(0xFFF85149)
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            "$openPortCount port(s) ouvert(s)",
                            fontSize = 13.sp,
                            color = Color(0xFF8B949E),
                            fontFamily = FontFamily.Monospace
                        )
                        Icon(
                            if (isExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                            contentDescription = null,
                            tint = Color(0xFF8B949E),
                            modifier = Modifier.size(20.dp).padding(top = 4.dp)
                        )
                    }
                }

                // Ports ouverts (dépliable)
                if (isExpanded && host.openPorts.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(12.dp))
                    androidx.compose.foundation.layout.Column(
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        host.openPorts.forEach { port ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Filled.LockOpen,
                                        contentDescription = null,
                                        tint = Color(0xFF3FB950),
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column(crossAxisAlignment = androidx.compose.ui.Alignment.Start) {
                                        Text(
                                            "${port.service} (${port.port})",
                                            fontSize = 13.sp,
                                            color = Color.White,
                                            fontFamily = FontFamily.Monospace
                                        )
                                        Text(
                                            "${host.ip}:${port.port}",
                                            fontSize = 11.sp,
                                            color = Color(0xFF8B949E),
                                            fontFamily = FontFamily.Monospace
                                        )
                                    }
                                }
                                Text(
                                    "OUVERT",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF3FB950)
                                )
                            }
                        }
                    }
                } else if (isExpanded) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        "Aucun port ouvert détecté sur les ports scannés",
                        fontSize = 13.sp,
                        color = Color(0xFF8B949E),
                        fontStyle = androidx.compose.ui.text.style.FontStyle.Italic
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        job.cancel()
        scanner?.shutdown()
    }
}
