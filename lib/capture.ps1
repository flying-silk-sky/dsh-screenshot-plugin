# ============================================================================
# dsh-screenshot-plugin - host capture script
# ============================================================================
# Captures the whole virtual desktop to a PNG, optionally hiding the window
# that hosts the DSH Web GUI first (so the frozen screenshot shows what was
# behind it) and restoring it afterwards.
#
# Invoked by lib/index.js through execFile, never through a shell:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
#     -File capture.ps1 -OutB64 <b64 out.png> -Mode hide|show -TitleB64 <b64>
#
# Stdout: one compact ASCII JSON line, e.g.
#   {"ok":true,"width":2560,"height":1440,"x":0,"y":0,"hidden":true,"reason":""}
# Failures print {"ok":false,"error":"..."} and exit 3.
# ============================================================================

param(
    [Parameter(Mandatory = $true)][string]$OutB64,
    [ValidateSet('hide', 'show')][string]$Mode = 'show',
    [string]$TitleB64 = ''
)

$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
}

function ConvertFrom-B64Text([string]$value) {
    if ([string]::IsNullOrEmpty($value)) { return '' }
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($value))
}

function Write-ResultLine([string]$json) {
    [Console]::Out.WriteLine($json)
}

$script:outPath = ConvertFrom-B64Text $OutB64
$script:titleHint = (ConvertFrom-B64Text $TitleB64).Trim()

$script:cs = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

namespace DshShot
{
    public static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT
        {
            public int length;
            public int flags;
            public int showCmd;
            public POINT ptMinPosition;
            public POINT ptMaxPosition;
            public RECT rcNormalPosition;
        }

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);
        [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    }
}
'@

try {
    if ([string]::IsNullOrEmpty($script:outPath)) { throw 'out path missing' }

    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition $script:cs -ReferencedAssemblies System.Drawing | Out-Null

    # Per-monitor DPI awareness keeps GetSystemMetrics and CopyFromScreen in
    # physical pixels on every monitor (falls back to system DPI awareness).
    try {
        [void][DshShot.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))
    } catch {
        try { [void][DshShot.Native]::SetProcessDPIAware() } catch { }
    }

    function Get-WindowTitle([IntPtr]$handle) {
        if ($handle -eq [IntPtr]::Zero) { return '' }
        $buffer = [System.Text.StringBuilder]::new(1024)
        [void][DshShot.Native]::GetWindowText($handle, $buffer, $buffer.Capacity)
        return $buffer.ToString()
    }

    function Find-TargetWindow() {
        $hint = $script:titleHint
        $foreground = [DshShot.Native]::GetForegroundWindow()
        $foregroundTitle = Get-WindowTitle $foreground
        if ($hint.Length -eq 0) {
            if ($foreground -ne [IntPtr]::Zero) { return @{ handle = $foreground; title = $foregroundTitle; reason = 'foreground' } }
            return @{ handle = [IntPtr]::Zero; title = ''; reason = 'not-found' }
        }
        if ($foreground -ne [IntPtr]::Zero -and $foregroundTitle.IndexOf($hint, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return @{ handle = $foreground; title = $foregroundTitle; reason = 'foreground' }
        }
        $script:matches = [System.Collections.ArrayList]::new()
        $callback = [DshShot.Native+EnumWindowsProc] {
            param([IntPtr]$hwnd, [IntPtr]$lparam)
            try {
                if ([DshShot.Native]::IsWindowVisible($hwnd) -and -not [DshShot.Native]::IsIconic($hwnd)) {
                    $text = Get-WindowTitle $hwnd
                    if ($text.Length -gt 0 -and $text.IndexOf($hint, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        [void]$script:matches.Add(@{ handle = $hwnd; title = $text })
                    }
                }
            } catch {
            }
            return $true
        }
        [void][DshShot.Native]::EnumWindows($callback, [IntPtr]::Zero)
        if ($script:matches.Count -gt 0) {
            $first = $script:matches[0]
            return @{ handle = $first.handle; title = $first.title; reason = 'title' }
        }
        if ($foreground -ne [IntPtr]::Zero) { return @{ handle = $foreground; title = $foregroundTitle; reason = 'foreground-fallback' } }
        return @{ handle = [IntPtr]::Zero; title = ''; reason = 'not-found' }
    }

    $target = @{ handle = [IntPtr]::Zero; title = ''; reason = 'not-found' }
    if ($Mode -eq 'hide') { $target = Find-TargetWindow }

    $hidden = $false
    $placement = New-Object DshShot.Native+WINDOWPLACEMENT
    $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
    $hasPlacement = $false

    if ($Mode -eq 'hide' -and $target.handle -ne [IntPtr]::Zero) {
        try {
            $hasPlacement = [DshShot.Native]::GetWindowPlacement($target.handle, [ref]$placement)
            if ([DshShot.Native]::ShowWindow($target.handle, 0)) {
                $hidden = $true
                Start-Sleep -Milliseconds 240
            }
        } catch {
            $hidden = $false
        }
    }

    try {
        $vsX = [DshShot.Native]::GetSystemMetrics(76)
        $vsY = [DshShot.Native]::GetSystemMetrics(77)
        $vsW = [DshShot.Native]::GetSystemMetrics(78)
        $vsH = [DshShot.Native]::GetSystemMetrics(79)
        if ($vsW -le 0 -or $vsH -le 0) { throw 'virtual screen bounds unavailable' }

        $bitmap = New-Object System.Drawing.Bitmap -ArgumentList $vsW, $vsH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $size = New-Object System.Drawing.Size -ArgumentList $vsW, $vsH
                $graphics.CopyFromScreen($vsX, $vsY, 0, 0, $size, [System.Drawing.CopyPixelOperation]::SourceCopy)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save($script:outPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }

        Write-ResultLine (@{
            ok     = $true
            width  = $vsW
            height = $vsH
            x      = $vsX
            y      = $vsY
            hidden = $hidden
            reason = [string]$target.reason
        } | ConvertTo-Json -Compress)
    } finally {
        if ($hidden -and $target.handle -ne [IntPtr]::Zero) {
            try {
                # Restore the exact previous state: a window that was minimized
                # before the capture stays minimized afterwards.
                $restoreCmd = 9
                if ($hasPlacement -and $placement.showCmd -gt 0) { $restoreCmd = $placement.showCmd }
                [void][DshShot.Native]::ShowWindow($target.handle, $restoreCmd)
                if ($hasPlacement) { [void][DshShot.Native]::SetWindowPlacement($target.handle, [ref]$placement) }
                [void][DshShot.Native]::BringWindowToTop($target.handle)
                if (-not ($hasPlacement -and ($placement.showCmd -eq 2 -or $placement.showCmd -eq 7))) {
                    [void][DshShot.Native]::SetForegroundWindow($target.handle)
                }
            } catch {
            }
        }
    }

    exit 0
} catch {
    $message = $_.Exception.Message
    if ([string]::IsNullOrEmpty($message)) { $message = 'capture failed' }
    $message = ($message -replace '[\r\n]+', ' ')
    Write-ResultLine ('{"ok":false,"error":"' + ($message -replace '"', "'") + '"}')
    exit 3
}
