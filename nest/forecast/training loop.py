import json
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_FILE = SCRIPT_DIR / 'simulation_dataset.json'

# 1. Load Data
with open(DATA_FILE) as f:
    data = json.load(f)

X_raw = torch.tensor([d['input'] for d in data], dtype=torch.float32)
Y_raw = torch.tensor([d['target'] for d in data], dtype=torch.float32)

# Extract conquest binary labels (0 or 1)
C_raw = torch.tensor([d.get('conquest', 0) for d in data], dtype=torch.float32).unsqueeze(1)

# 2. Compute Normalization Statistics (Z-Score)
# Standardize continuous variables only; conquest targets remain binary (0 or 1)
X_mean, X_std = X_raw.mean(dim=0), X_raw.std(dim=0) + 1e-7
Y_mean, Y_std = Y_raw.mean(dim=0), Y_raw.std(dim=0) + 1e-7

X_norm = (X_raw - X_mean) / X_std
Y_norm = (Y_raw - Y_mean) / Y_std

# 3. Train/Val Split (80/20) & DataLoaders
dataset = TensorDataset(X_norm, Y_norm, C_raw)
train_size = int(0.8 * len(dataset))
val_size = len(dataset) - train_size
train_ds, val_ds = torch.utils.data.random_split(dataset, [train_size, val_size])

train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)
val_loader = DataLoader(val_ds, batch_size=256, shuffle=False)

# 4. Multi-Task Architecture: Shared Backbone with Dual Output Heads
class ResBlock(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, dim),
            nn.LayerNorm(dim),
            nn.SiLU(),
            nn.Linear(dim, dim),
            nn.LayerNorm(dim)
        )
        self.act = nn.SiLU()

    def forward(self, x):
        return self.act(x + self.net(x))

class MultiTaskDynamicsPredictor(nn.Module):
    def __init__(self, state_dim, hidden_dim=128):
        super().__init__()
        self.in_proj = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.SiLU()
        )
        self.res1 = ResBlock(hidden_dim)
        self.res2 = ResBlock(hidden_dim)

        # Output Heads
        self.delta_head = nn.Linear(hidden_dim, state_dim)   # Regression head
        self.conquest_head = nn.Linear(hidden_dim, 1)       # Classification head (logits)

    def forward(self, x):
        x = self.in_proj(x)
        x = self.res1(x)
        x = self.res2(x)
        
        delta_logits = self.delta_head(x)
        conquest_logits = self.conquest_head(x)
        return delta_logits, conquest_logits

model = MultiTaskDynamicsPredictor(state_dim=X_raw.shape[1])
optimizer = optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=10)

# Multi-task loss criteria
criterion_mse = nn.MSELoss()
criterion_bce = nn.BCEWithLogitsLoss()
lambda_conquest = 1.0  # Loss weighting factor for conquest classification

# 5. Training Loop with Multi-Task Loss
epochs = 150

for epoch in range(epochs):
    model.train()
    train_loss = 0.0
    for bx, by, bc in train_loader:
        optimizer.zero_grad()
        p_delta, p_conquest = model(bx)
        
        loss_delta = criterion_mse(p_delta, by)
        loss_conquest = criterion_bce(p_conquest, bc)
        loss = loss_delta + (lambda_conquest * loss_conquest)
        
        loss.backward()
        optimizer.step()
        train_loss += loss.item() * len(bx)
    train_loss /= train_size

    # Validation Phase
    model.eval()
    val_loss = 0.0
    with torch.no_grad():
        for bx, by, bc in val_loader:
            p_delta, p_conquest = model(bx)
            l_delta = criterion_mse(p_delta, by)
            l_conquest = criterion_bce(p_conquest, bc)
            val_loss += (l_delta + (lambda_conquest * l_conquest)).item() * len(bx)
    val_loss /= val_size

    scheduler.step(val_loss)

    if (epoch + 1) % 15 == 0 or epoch == epochs - 1:
        print(f"Epoch {epoch+1:03d} | Train Loss: {train_loss:.6f} | Val Loss: {val_loss:.6f}")

# 6. ONNX Export Wrapper (Multi-Output)
class ONNXInferenceWrapper(nn.Module):
    """
    Wraps the model for ONNX export:
    - Scales input using z-score normalization.
    - Denormalizes continuous state prediction.
    - Converts conquest logits to probabilities [0, 1].
    """
    def __init__(self, trained_model, x_mean, x_std, y_mean, y_std):
        super().__init__()
        self.model = trained_model
        self.register_buffer('x_mean', x_mean)
        self.register_buffer('x_std', x_std)
        self.register_buffer('y_mean', y_mean)
        self.register_buffer('y_std', y_std)

    def forward(self, x_raw):
        x_norm = (x_raw - self.x_mean) / self.x_std
        p_delta_norm, p_conquest_logits = self.model(x_norm)
        
        # Denormalize state deltas
        p_delta = (p_delta_norm * self.y_std) + self.y_mean
        # Convert logits to probability
        p_conquest_prob = torch.sigmoid(p_conquest_logits)
        
        return p_delta, p_conquest_prob

model.eval()
onnx_ready_model = ONNXInferenceWrapper(model, X_mean, X_std, Y_mean, Y_std)

dummy_raw_input = X_raw[:1]
torch.onnx.export(
    onnx_ready_model,
    dummy_raw_input,
    "dynamics_model.onnx",
    input_names=['state'],
    output_names=['delta', 'conquest_prob'],
    dynamic_axes={
        'state': {0: 'batch'},
        'delta': {0: 'batch'},
        'conquest_prob': {0: 'batch'}
    }
)
print("Exported multi-task dynamics_model.onnx successfully.")