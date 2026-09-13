param([int]$Seconds = 15, [int]$DebugPort = 19287)
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process)
$listener = @(Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue)
$rootIds = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
$roots = @($processes | Where-Object { $rootIds -contains $_.ProcessId })
if (!$roots.Count) { throw "No player process listening on debugging port $DebugPort" }
$ids = [Collections.Generic.HashSet[int]]::new()
foreach ($item in $roots) { $null = $ids.Add($item.ProcessId) }
do {
  $before = $ids.Count
  foreach ($item in $processes) { if ($ids.Contains($item.ParentProcessId)) { $null = $ids.Add($item.ProcessId) } }
} while ($ids.Count -gt $before)
$initial = @{}
foreach ($taskProcessId in $ids) {
  $item = Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue
  if ($item) { $initial[$taskProcessId] = @{ Cpu=$item.TotalProcessorTime.TotalSeconds; Name=$item.ProcessName } }
}
$clock = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$elapsed = $clock.Elapsed.TotalSeconds
$cores = [Environment]::ProcessorCount
$samples = @(foreach ($taskProcessId in $initial.Keys) {
  $item = Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue
  if ($item) {
    $cpu = $item.TotalProcessorTime.TotalSeconds - $initial[$taskProcessId].Cpu
    [pscustomobject]@{ pid=$taskProcessId; name=$item.ProcessName; cpuSeconds=$cpu; systemCpuPercent=100*$cpu/$elapsed/$cores; workingSetMiB=$item.WorkingSet64/1MB }
  }
})
$ended = @($initial.Keys | Where-Object { -not (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
[pscustomobject]@{ seconds=$elapsed; logicalProcessors=$cores; rootProcessIds=$rootIds; endedProcessIds=$ended; totalSystemCpuPercent=($samples|Measure-Object systemCpuPercent -Sum).Sum; processes=$samples } | ConvertTo-Json -Depth 4 -Compress
