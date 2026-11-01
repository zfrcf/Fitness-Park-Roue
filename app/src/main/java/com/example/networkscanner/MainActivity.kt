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
