let API_BASE_URL = "http://localhost:3000";
let WS_URL = "ws://localhost:3000";

let machineId = "VM-01";
let showInactiveProducts = false;

let summary = {
    totalRevenue: 0,
    totalTransactions: 0,
    productsRemaining: 0,
    lowStockItems: 0,
    productTypes: 0,
    machineStatus: "Offline",
    lastUpdated: null
};

let products = [];
let coinInventory = {
    one_peso: 0,
    five_peso: 0,
    ten_peso: 0,
    twenty_peso: 0,
    updated_at: null
};

let transactions = [];
let machineLogs = [];

let revenueChart = null;
let isEditMode = false;

async function loadDashboardData() {
    try {
        const summaryResponse = await fetch(`${API_BASE_URL}/api/summary`);
        summary = await summaryResponse.json();

        const productsResponse = await fetch(`${API_BASE_URL}/api/products`);
        products = await productsResponse.json();

        const coinResponse = await fetch(`${API_BASE_URL}/api/coin-inventory`);
        coinInventory = await coinResponse.json();

        const transactionResponse = await fetch(`${API_BASE_URL}/api/transactions?limit=13`);
        transactions = await transactionResponse.json();

        const logsResponse = await fetch(`${API_BASE_URL}/api/machine-logs`);
        machineLogs = await logsResponse.json();

        updateDashboard();

    } catch (error) {
        console.error("Failed to load dashboard data:", error);

        summary.machineStatus = "Offline";
        updateDashboard();
    }
}

function connectWebSocket() {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "summary") {
            summary = data.payload;
        }

        if (data.type === "productInventory") {
            products = data.payload;
        }

        if (data.type === "coinInventory") {
            coinInventory = data.payload;
        }

        if (data.type === "transactions") {
            transactions = data.payload;
        }

        if (data.type === "machineLogs") {
            machineLogs = data.payload;
        }

        updateDashboard();
    };

    socket.onclose = () => {
        console.log("WebSocket disconnected. Reconnecting...");
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
        console.error("WebSocket error:", error);
    };
}

function getProductStatus(stock) {
    const value = Number(stock) || 0;

    if (value <= 0) return "Sold Out";
    if (value <= 2) return "Low Stock";
    return "Available";
}

function getStatusClass(status) {
    const value = String(status || "").toLowerCase();

    if (
        value === "inactive"
    ) {
        return "danger";
    }

    if (
        value === "available" ||
        value === "success" ||
        value === "resolved" ||
        value === "online" ||
        value === "transaction" ||
        value === "coin update" ||
        value === "restock"
    ) {
        return "success";
    }

    if (
        value === "low stock" ||
        value === "warning"
    ) {
        return "warning";
    }

    if (
        value === "sold out" ||
        value === "critical" ||
        value === "failed" ||
        value === "offline" ||
        value === "error"
    ) {
        return "danger";
    }

    return "success";
}

function formatPeso(value) {
    const amount = Number(value) || 0;
    return "₱" + amount.toLocaleString();
}

function formatTime(value) {
    if (!value) return "No update";

    const date = new Date(value);

    date.setHours(date.getHours() + 8);

    return date.toLocaleString("en-PH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    });
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.innerText = value;
    }
}

function updateDashboard() {
    const status = summary.machineStatus ?? "Offline";
    const isOnline = String(status).toLowerCase() === "online";
    const lastLogTime = machineLogs?.[0]?.created_at;

    setText("totalRevenue", formatPeso(summary.totalRevenue ?? summary.total_revenue));
    setText("totalTransactions", summary.totalTransactions ?? summary.total_transactions ?? transactions.length);
    setText("productsRemaining", summary.productsRemaining ?? summary.products_remaining ?? getProductsRemaining());
    setText("lowStockItems", summary.lowStockItems ?? summary.low_stock_items ?? getLowStockItems());
    setText("lastUpdated", formatTime(lastLogTime));

    const machineStatusElement = document.getElementById("machineStatus");

    if (machineStatusElement) {
        machineStatusElement.innerHTML = `
            <span class="machine-dot ${isOnline ? "online" : "offline"}"></span>
            ${isOnline ? "Online" : "Offline"}
        `;
    }

    displayInventoryTable();
    displayCoinInventory();
    displayTransactions();
    displayMachineLogs();
}

function getProductsRemaining() {
    return products.reduce((sum, product) => {
        return sum + (Number(product.stock_count) || 0);
    }, 0);
}

function getLowStockItems() {
    return products.filter(product => {
        const stock = Number(product.stock_count) || 0;
        return stock > 0 && stock <= 2;
    }).length;
}

function displayInventoryTable() {
    const table = document.getElementById("inventoryTable");
    if (!table) return;

    table.innerHTML = "";

    products.filter(product => {if (showInactiveProducts) return true;return product.is_active !== false;}).forEach(product => {
        const productId = product.product_id;
        const productName = product.product_name;
        const price = Number(product.price) || 0;
        const stock = Number(product.stock_count) || 0;
        const maxCapacity = Number(product.max_capacity) || 0;
        const status = product.is_active === false
            ? "Inactive"
            : getProductStatus(stock);

        const nameField = isEditMode && product.is_active !== false
            ? `<input type="text" class="edit-name" data-id="${productId}" value="${productName}" />`
            : productName + (product.is_active === false ? ' 🔒' : '');

        const priceField = isEditMode && product.is_active !== false
            ? `<input type="number" class="edit-price" data-id="${productId}" value="${price}" />`
            : formatPeso(price) + (product.is_active === false ? ' 🔒' : '');

        const stockField = isEditMode && product.is_active !== false
            ? `<input type="number" class="edit-stock" data-id="${productId}" value="${stock}" />`
            : stock + (product.is_active === false ? ' 🔒' : '');

        const maxField = isEditMode && product.is_active !== false
            ? `<input type="number" class="edit-max" data-id="${productId}" value="${maxCapacity}" />`
            : maxCapacity + (product.is_active === false ? ' 🔒' : '');

        const actionButtons = product.is_active === false
            ? `<button class="reactivate-btn" data-id="${productId}">
                Reactivate
            </button>`
            : `
                <button class="restock-btn" data-id="${productId}">
                    Restock
                </button>

                <button class="deactivate-btn btn-danger" data-id="${productId}">
                    Deactivate
                </button>
            `;

        table.innerHTML += `
            <tr>
                <td>${productId}</td>
                <td>${nameField}</td>
                <td>${priceField}</td>
                <td>${stockField}</td>
                <td>${maxField}</td>
                <td>
                    <span class="table-status ${getStatusClass(status)}">
                        ${status}
                    </span>
                </td>
                <td>
                    ${actionButtons}
                </td>
            </tr>
        `;
    });
}

function displayCoinInventory() {
    const onePeso = Number(coinInventory?.one_peso) || 0;
    const fivePeso = Number(coinInventory?.five_peso) || 0;
    const tenPeso = Number(coinInventory?.ten_peso) || 0;
    const twentyPeso = Number(coinInventory?.twenty_peso) || 0;

    const oneTotal = onePeso * 1;
    const fiveTotal = fivePeso * 5;
    const tenTotal = tenPeso * 10;
    const twentyTotal = twentyPeso * 20;

    const totalPieces = onePeso + fivePeso + tenPeso + twentyPeso;
    const totalValue = oneTotal + fiveTotal + tenTotal + twentyTotal;
    
    setText("cashInMachine", formatPeso(totalValue));
    setText("onePesoCount", `${onePeso} pcs`);
    setText("onePesoTotal", formatPeso(oneTotal));

    setText("fivePesoCount", `${fivePeso} pcs`);
    setText("fivePesoTotal", formatPeso(fiveTotal));

    setText("tenPesoCount", `${tenPeso} pcs`);
    setText("tenPesoTotal", formatPeso(tenTotal));

    setText("twentyPesoCount", `${twentyPeso} pcs`);
    setText("twentyPesoTotal", formatPeso(twentyTotal));

    setText("totalCoinPieces", `${totalPieces} pcs`);
    setText("totalCoinValue", formatPeso(totalValue));
}

function displayTransactions() {
    const table = document.getElementById("allTransactionTable");

    if (!table) return;

    table.innerHTML = "";

    if (!transactions || transactions.length === 0) {
        table.innerHTML = `
            <tr>
                <td colspan="8">No transactions found.</td>
            </tr>
        `;
        return;
    }

    transactions.forEach(transaction => {
        const id = transaction.transaction_id;
        const time = transaction.created_at;
        const productName = transaction.product_name || "N/A";
        const quantity = transaction.quantity || 0;
        const totalAmount = transaction.total_amount || 0;
        const coinInserted = transaction.coin_inserted || 0;
        const changeGiven = transaction.change_given || 0;
        const status = transaction.status || "Success";

        table.innerHTML += `
            <tr>
                <td>#TRX${id}</td>
                <td>${formatTime(time)}</td>
                <td>${productName}</td>
                <td>${quantity}</td>
                <td>${formatPeso(totalAmount)}</td>
                <td>${formatPeso(coinInserted)}</td>
                <td>${formatPeso(changeGiven)}</td>
                <td>
                    <span class="table-status ${getStatusClass(status)}">
                        ${status}
                    </span>
                </td>
            </tr>
        `;
    });
}

async function saveInventoryChanges() {
    const updates = [];

    document.querySelectorAll(".edit-stock").forEach(input => {
        updates.push({
            product_id: input.dataset.id,
            stock_count: input.value
        });
    });

    document.querySelectorAll(".edit-max").forEach(input => {
        const item = updates.find(u => u.product_id === input.dataset.id);
        if (item) item.max_capacity = input.value;
    });

    document.querySelectorAll(".edit-price").forEach(input => {
        const item = updates.find(u => u.product_id === input.dataset.id);
        if (item) item.price = input.value;
    });

    document.querySelectorAll(".edit-name").forEach(input => {
        const item = updates.find(u => u.product_id === input.dataset.id);
        if (item) item.product_name = input.value;
    });

    await fetch(`${API_BASE_URL}/api/products/bulk-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates })
    });

    alert("Inventory updated!");

    isEditMode = false;
    document.getElementById("editInventoryBtn").innerText = "Edit Inventory";

    await loadDashboardData();
}

function displayMachineLogs() {
    const table = document.getElementById("machineLogsTable");

    if (!table) return;

    table.innerHTML = "";

    if (!machineLogs || machineLogs.length === 0) {
        table.innerHTML = `
            <tr>
                <td colspan="4">No machine logs found.</td>
            </tr>
        `;
        return;
    }

    machineLogs.slice(0, 13).forEach(log => {
        const logType = log.log_type || "Info";

        table.innerHTML += `
            <tr>
                <td>${log.log_id}</td>
                <td>
                    <span class="table-status ${getStatusClass(logType)}">
                        ${logType}
                    </span>
                </td>
                <td>${log.message}</td>
                <td>${formatTime(log.created_at)}</td>
            </tr>
        `;
    });
}

async function restockProduct(productId) {
    try {
        console.log("Restocking product:", productId);

        const response = await fetch(
            `${API_BASE_URL}/api/product-inventory/${productId}/restock`,
            { method: "POST" }
        );

        const data = await response.json();

        console.log("RESTOCK RESPONSE:", data);
        console.log("STATUS:", response.status);

        if (!response.ok) {
            throw new Error(data.message || "Request failed");
        }

        showSuccessModal("Product has been restocked successfully!", "Restock Complete");

        await loadDashboardData();

    } catch (err) {
        console.error("RESTOCK ERROR:", err);
        alert("Restock failed. Check console.");
    }
}

function loadChart() {
    const ctx = document.getElementById("revenueChart");

    if (!ctx) return;

    revenueChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            datasets: [
                {
                    label: "Daily Revenue",
                    data: [250, 320, 180, 450, 390, 520, 610],
                    borderColor: "#22c55e",
                    backgroundColor: "rgba(34, 197, 94, 0.18)",
                    fill: true,
                    borderWidth: 3,
                    tension: 0.45,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                },
            ],
        },
        options: {
            responsive: true,
            interaction: {
                mode: "index",
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return "₱" + value;
                        },
                    },
                },
            },
        },
    });
}

function showSuccessModal(message = "Success", title = "Success") {
    const modal = document.getElementById("successModal");
    const titleEl = document.getElementById("successTitle");
    const msgEl = document.getElementById("successMessage");

    titleEl.innerText = title;
    msgEl.innerText = message;

    modal.classList.remove("hidden");
}

function closeSuccessModal() {
    document.getElementById("successModal").classList.add("hidden");
}

function exportLogsToCSV() {
    if (!machineLogs || machineLogs.length === 0) {
        alert("No logs to export.");
        return;
    }

    const headers = ["Log ID", "Type", "Message", "Time"];

    const rows = machineLogs.map(log => [
        log.log_id,
        log.log_type,
        log.message,
        log.created_at
    ]);

    let csvContent = "data:text/csv;charset=utf-8,"
        + headers.join(",") + "\n"
        + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");

    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `machine_logs_${Date.now()}.csv`);
    document.body.appendChild(link);

    link.click();
    document.body.removeChild(link);
}

async function clearLogs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/machine-logs/clear`, {
            method: "DELETE"
        });

        if (!res.ok) throw new Error("Failed");

        await loadDashboardData();
        alert("Logs cleared.");
    } catch (err) {
        console.error(err);
        alert("Failed to clear logs.");
    }
}

const navLinks = document.querySelectorAll(".nav-link");
const sections = document.querySelectorAll(".page-section");

navLinks.forEach(link => {
    link.addEventListener("click", function(e) {
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

// CLEAR TRANSACTIONS
document.getElementById("clearTransactionsBtn")?.addEventListener("click", async () => {
    const confirmed = confirm("Are you sure you want to clear all transactions?");
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/transactions/clear`, {
            method: "DELETE"
        });

        const data = await response.json();

        if (!data.success) throw new Error();

        alert("Transactions cleared successfully.");
        await loadDashboardData();

    } catch (err) {
        console.error(err);
        alert("Failed to clear transactions.");
    }
});


// CLEAR MACHINE LOGS
document.getElementById("clearLogsBtn")?.addEventListener("click", async () => {
    const confirmed = confirm("Are you sure you want to clear all machine logs?");
    if (!confirmed) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/machine-logs/clear`, {
            method: "DELETE"
        });

        const data = await res.json();

        if (!res.ok || !data.success) throw new Error();

        alert("Machine logs cleared successfully.");
        await loadDashboardData();

    } catch (err) {
        console.error(err);
        alert("Failed to clear machine logs.");
    }
});

const exportBtn = document.getElementById("exportBtn");

if (exportBtn) {
    exportBtn.addEventListener("click", function() {
        alert("Export feature coming soon.");
    });
}

const saveSettingsBtn = document.getElementById("saveSettingsBtn");

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", function() {
        const machineInput = document.getElementById("machineIdInput");
        const apiInput = document.getElementById("apiInput");

        if (machineInput) {
            machineId = machineInput.value || "VM-01";
        }

        if (apiInput && apiInput.value.trim() !== "") {
            API_BASE_URL = apiInput.value.trim();
            WS_URL = API_BASE_URL.replace("http://", "ws://").replace("https://", "wss://");
        }

        alert("Settings saved. Refresh the page to reconnect with the new API URL.");
    });
}

const resetModal = document.getElementById("resetModal");
const resetBtn = document.getElementById("resetCoinsBtn");
const cancelBtn = document.getElementById("cancelResetBtn");
const confirmBtn = document.getElementById("confirmResetBtn");

if (resetBtn) {
    resetBtn.addEventListener("click", () => {
        resetModal.classList.remove("hidden");
    });
}

if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
        resetModal.classList.add("hidden");
    });
}

if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/coin-inventory/reset`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ machineId })
            });

            const data = await response.json();

            if (!data.success) throw new Error("Reset failed");

            resetModal.classList.add("hidden");

            alert("Coin inventory reset successfully!");

        } catch (err) {
            console.error(err);
            alert("Failed to reset coin inventory.");
        }
    });
}

document.addEventListener("click", async (e) => {

    // RESTOCK
    const restockBtn = e.target.closest(".restock-btn");
    if (restockBtn) {
        const productId = restockBtn.dataset.id;
        await restockProduct(productId);
        return;
    }

    // DEACTIVATE
    const deactivateBtn = e.target.closest(".deactivate-btn");
    if (deactivateBtn) {
        const productId = deactivateBtn.dataset.id;

        const confirmDeactivate = confirm(
            "Are you sure you want to deactivate this product?"
        );

        if (!confirmDeactivate) return;

        try {
            const res = await fetch(
                `${API_BASE_URL}/api/products/${productId}`,
                {
                    method: "DELETE"
                }
            );

            const data = await res.json();
            if (!data.success) throw new Error();

            showSuccessModal(
                "Product deactivated successfully",
                "Deactivated"
            );

            await loadDashboardData();

        } catch (err) {
            console.error(err);
            alert("Failed to deactivate product.");
        }

        return;
    }

    const reactivateBtn = e.target.closest(".reactivate-btn");
    if (reactivateBtn) {
        const productId = reactivateBtn.dataset.id;

        try {
            const res = await fetch(`${API_BASE_URL}/api/products/${productId}/reactivate`, {
                method: "POST"
            });

            const data = await res.json();
            if (!data.success) throw new Error();

            showSuccessModal("Product reactivated successfully", "Reactivated");

            await loadDashboardData();
        } catch (err) {
            console.error(err);
            alert("Failed to reactivate product.");
        }

        return;
    }
});

document.getElementById("successOkBtn")?.addEventListener("click", () => {
    closeSuccessModal();
});

document.getElementById("exportLogsBtn")?.addEventListener("click", exportLogsToCSV);

document.getElementById("clearLogsBtn")?.addEventListener("click", clearLogs);

document.getElementById("editInventoryBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("editInventoryBtn");

    if (!isEditMode) {
        isEditMode = true;
        btn.innerText = "Save Changes";
        btn.classList.add("editing");
    } else {
        await saveInventoryChanges();
        isEditMode = false;
        btn.innerText = "Edit Inventory";
        btn.classList.remove("editing");
    }

    displayInventoryTable();
});

const addProductBtn =
    document.getElementById("addProductBtn");

const addProductModal =
    document.getElementById("addProductModal");

const cancelAddProductBtn =
    document.getElementById("cancelAddProductBtn");

addProductBtn?.addEventListener("click", () => {
    addProductModal.classList.remove("hidden");
});

cancelAddProductBtn?.addEventListener("click", () => {
    addProductModal.classList.add("hidden");
});

document.getElementById("confirmAddProductBtn")?.addEventListener("click", async () => {

    const product_name =
        document.getElementById("newProductName").value;

    const price =
        Number(document.getElementById("newProductPrice").value);

    const stock_count =
        Number(document.getElementById("newProductStock").value);

    const max_capacity =
        Number(document.getElementById("newProductMax").value);

    try {

        const response = await fetch(
            `${API_BASE_URL}/api/products`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    product_name,
                    price,
                    stock_count,
                    max_capacity
                })
            }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error();
        }

        addProductModal.classList.add("hidden");

        await loadDashboardData();

        showSuccessModal(
            "Product added successfully!",
            "Product Added"
        );

    } catch (err) {

        console.error(err);

        alert("Failed to add product.");
    }
});

document.getElementById("showInactiveProducts")?.addEventListener("change", (e) => {
    showInactiveProducts = e.target.checked;
    displayInventoryTable();
});

connectWebSocket();
loadChart();
loadDashboardData();