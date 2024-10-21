# Variables
$mongoVersion = "8.0.0"
$mongoDir = "..\mongodb"
$mongoBin = "$mongoDir\bin\mongod.exe"
$dataDir = "$mongoDir\data\db"

function Download-MongoDB {
    Write-Host "Downloading MongoDB $mongoVersion..."
    $downloadUrl = "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$mongoVersion.zip"
    $zipFile = "mongodb.zip"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipFile
    Expand-Archive -Path $zipFile -DestinationPath $mongoDir
    Remove-Item $zipFile
    # Move files up one directory level
    $extractedDir = Get-ChildItem $mongoDir | Where-Object { $_.PSIsContainer } | Select-Object -First 1
    Move-Item "$mongoDir\$($extractedDir.Name)\*" $mongoDir
    Remove-Item "$mongoDir\$($extractedDir.Name)" -Recurse
    Write-Host "MongoDB downloaded and extracted to $mongoDir"
}

# Check if MongoDB is installed locally
if (-Not (Test-Path $mongoBin)) {
    Download-MongoDB
} else {
    Write-Host "MongoDB is already installed locally."
}

# Create data directory if it doesn't exist
if (-Not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir
}

# Start MongoDB
Write-Host "Starting MongoDB..."
& $mongoBin --dbpath $dataDir
