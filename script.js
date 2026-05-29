import { config } from "./config.js";
const machineId = "VENDO-01";

const domain = config.DOMAIN

console.log(domain);

let onePeso = 0;
let fivePeso = 0;
let tenPeso = 0;
let twentyPeso = 0;

let transactions = [];

async function loadDashboardData() {

    try {

        // =========================
        // COIN INVENTORY
        // =========================

        const coinResponse = await fetch(domain+"/api/coin-inventory");
        const coinData = await coinResponse.json();

        onePeso = coinData.one_peso || 0;
        fivePeso = coinData.five_peso || 0;
        tenPeso = coinData.ten_peso || 0;
        twentyPeso = coinData.twenty_peso || 0;

        // =========================
        // TRANSACTIONS
        // =========================

        const transactionResponse = await fetch(domain+"/api/transactions");
        const transactionData = await transactionResponse.json();

        transactions = transactionData.map(transaction => {

            return {

                time: new Date(transaction.created_at).toLocaleTimeString(),

                coin: "₱" + transaction.coin_inserted,

                machine: machineId,

                status: transaction.status
            };

        });

        updateDashboard();

    } catch (error) {

        console.error("Failed to load dashboard data:", error);

    }
}

function updateDashboard() {

    let totalAmount =
        (onePeso * 1) +
        (fivePeso * 5) +
        (tenPeso * 10) +
        (twentyPeso * 20);

    let totalCoins =
        onePeso +
        fivePeso +
        tenPeso +
        twentyPeso;

    document.getElementById("totalAmount").innerText =
        "₱" + totalAmount;

    document.getElementById("totalCoins").innerText =
        totalCoins + " pcs";

    document.getElementById("machineStatus").innerHTML = `
        <span class="machine-dot online"></span>
        Online
    `;

    document.getElementById("onePesoCount").innerText =
        onePeso + " pcs";

    document.getElementById("fivePesoCount").innerText =
        fivePeso + " pcs";

    document.getElementById("tenPesoCount").innerText =
        tenPeso + " pcs";

    document.getElementById("coinPageOnePeso").innerText =
    onePeso + " pcs";

document.getElementById("coinPageFivePeso").innerText =
    fivePeso + " pcs";

document.getElementById("coinPageTenPeso").innerText =
    tenPeso + " pcs";

// =========================
// REPORT SECTION
// =========================

let oneTotal = onePeso * 1;
let fiveTotal = fivePeso * 5;
let tenTotal = tenPeso * 10;

document.getElementById("reportOnePeso").innerText =
    onePeso + " pcs";

document.getElementById("reportOneTotal").innerText =
    "₱" + oneTotal;

document.getElementById("reportFivePeso").innerText =
    fivePeso + " pcs";

document.getElementById("reportFiveTotal").innerText =
    "₱" + fiveTotal;

document.getElementById("reportTenPeso").innerText =
    tenPeso + " pcs";

document.getElementById("reportTenTotal").innerText =
    "₱" + tenTotal;

document.getElementById("reportTotalCoins").innerText =
    totalCoins + " pcs";

document.getElementById("reportTotalAmount").innerText =
    "₱" + totalAmount;

    document.getElementById("lastUpdated").innerText =
        new Date().toLocaleTimeString();

    displayTransactions();
}

function displayTransactions() {

    const table =
        document.getElementById("transactionTable");

    table.innerHTML = "";

    transactions.forEach(transaction => {

        table.innerHTML += `
            <tr>
                <td>${transaction.time}</td>
                <td>${transaction.coin}</td>
                <td>${transaction.machine}</td>
                <td>${transaction.status}</td>
            </tr>
        `;

    });
}

document.getElementById("refreshBtn")
.addEventListener("click", function () {

    loadDashboardData();

});

loadDashboardData();

setInterval(loadDashboardData, 5000);

function loadChart() {
    const ctx = document.getElementById("coinChart");

    new Chart(ctx, {

        type: "line",
        data: {

            labels: [
                "Mon",
                "Tue",
                "Wed",
                "Thu",
                "Fri",
                "Sat",
                "Sun"
            ],

            datasets: [

                {
                    label: "Daily Analytics",
                    data: [25, 40, 35, 70, 55, 90, 120],
                    borderColor: "#22c55e",
                    backgroundColor: "rgba(34, 197, 94, 0.18)",
                    fill: true,
                    borderWidth: 3,
                    tension: 0.45,
                    pointRadius: 0,
                    pointHoverRadius: 6
                },

                {
                    label: "Weekly Analytics",
                    data: [80, 120, 100, 150, 140, 180, 220],
                    borderColor: "#86efac",
                    backgroundColor: "rgba(134, 239, 172, 0.15)",
                    fill: true,
                    borderWidth: 3,
                    tension: 0.45,
                    pointRadius: 0,
                    pointHoverRadius: 6
                },

                {
                    label: "Monthly Analytics",
                    data: [300, 420, 390, 500, 480, 620, 750],
                    borderColor: "#16a34a",
                    backgroundColor: "rgba(22, 163, 74, 0.12)",
                    fill: true,
                    borderWidth: 3,
                    tension: 0.45,
                    pointRadius: 0,
                    pointHoverRadius: 6
                }
            ]
        },

        options: {
            responsive: true,

            interaction: {
                mode: 'index',
                intersect: false
            },

            plugins: {  

                legend: {
                    display: true,
                    position: 'top',
                    labels: {

                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 25,
                        font: {
                            size: 13,
                            weight: '600'
                        }
                    }
                }
            },

            scales: {

                y: {
                    beginAtZero: true,

                    grid: {
                        color: "rgba(0,0,0,0.05)",
                        drawBorder: false
                    },

                    ticks: {
                        color: "#94a3b8"
                    }
                },

                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: "#94a3b8"
                    }
                }
            }
        }
    });
}

loadChart();

const navLinks = document.querySelectorAll(".nav-link");
const sections = document.querySelectorAll(".page-section");

navLinks.forEach(link => {
    link.addEventListener("click", function (e) {
        e.preventDefault();

        navLinks.forEach(nav => nav.classList.remove("active"));
        this.classList.add("active");

        sections.forEach(section => {
            section.classList.remove("active-section");
        });

        const targetSection = this.getAttribute("data-section");
        document.getElementById(targetSection).classList.add("active-section");
    });
});

document.getElementById("clearBtn").addEventListener("click", function () {

    document.getElementById("allTransactionTable").innerHTML = "";

});

document.getElementById("exportBtn").addEventListener("click", function () {

    alert("Export feature coming soon.");

});

document.getElementById("generateReportBtn").addEventListener("click", function () {

    let oneTotal = onePeso * 1;
    let fiveTotal = fivePeso * 5;
    let tenTotal = tenPeso * 10;

    let totalCoins = onePeso + fivePeso + tenPeso;
    let totalAmount = oneTotal + fiveTotal + tenTotal;

    document.getElementById("reportOnePeso").innerText = onePeso + " pcs";
    document.getElementById("reportOneTotal").innerText = "₱" + oneTotal;

    document.getElementById("reportFivePeso").innerText = fivePeso + " pcs";
    document.getElementById("reportFiveTotal").innerText = "₱" + fiveTotal;

    document.getElementById("reportTenPeso").innerText = tenPeso + " pc";
    document.getElementById("reportTenTotal").innerText = "₱" + tenTotal;

    document.getElementById("reportTotalCoins").innerText = totalCoins + " pcs";
    document.getElementById("reportTotalAmount").innerText = "₱" + totalAmount;

    let csvContent =
        "\uFEFFCoin Type,Pieces,Total Value\n" +
        "PHP 1," + onePeso + "," + oneTotal + "\n" +
        "PHP 5," + fivePeso + "," + fiveTotal + "\n" +
        "PHP 10," + tenPeso + "," + tenTotal + "\n" +
        "Overall Total," + totalCoins + "," + totalAmount;

    let file = new Blob(
        [csvContent],
        { type: "text/csv;charset=utf-8;" }
    );

    let link = document.createElement("a");

    link.href = URL.createObjectURL(file);

    link.download = "vendo_coin_report.csv";

    link.click();

    alert("Report downloaded successfully.");

});