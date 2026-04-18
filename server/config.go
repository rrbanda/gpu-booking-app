package main

// GPUResourceSpec defines a single GPU resource type with all its properties.
// This is the single source of truth for the GPU pool — used by the API config
// endpoint, reservation quota calculations, and Kueue sync filtering.
type GPUResourceSpec struct {
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	Count         int     `json:"count"`
	Share         float64 `json:"share"`
	GPUEquivalent float64 `json:"gpuEquivalent"`
}

var gpuResourceSpecs = []GPUResourceSpec{
	{Name: "H200 Full GPU", Type: "nvidia.com/gpu", Count: 8, Share: 0.0625, GPUEquivalent: 1.0},
	{Name: "MIG 3g.71gb", Type: "nvidia.com/mig-3g.71gb", Count: 8, Share: 0.03125, GPUEquivalent: 0.5},
	{Name: "MIG 2g.35gb", Type: "nvidia.com/mig-2g.35gb", Count: 8, Share: 0.015625, GPUEquivalent: 0.25},
	{Name: "MIG 1g.18gb", Type: "nvidia.com/mig-1g.18gb", Count: 16, Share: 0.0078125, GPUEquivalent: 0.125},
}

const (
	totalCPU    = 316
	totalMemory = 3460 // Gi
)

// ConfigResponse is the JSON shape returned by GET /api/config.
type ConfigResponse struct {
	Resources         []GPUResourceSpec `json:"resources"`
	BookingWindowDays int               `json:"bookingWindowDays"`
	TotalCPU          int               `json:"totalCpu"`
	TotalMemory       int               `json:"totalMemory"`
}

func getConfig() ConfigResponse {
	return ConfigResponse{
		Resources:         gpuResourceSpecs,
		BookingWindowDays: bookingWindowDays,
		TotalCPU:          totalCPU,
		TotalMemory:       totalMemory,
	}
}

func isGPUResource(name string) bool {
	for _, spec := range gpuResourceSpecs {
		if spec.Type == name {
			return true
		}
	}
	return false
}

// gpuSpecByType returns the spec for a GPU resource type, or ok=false.
func gpuSpecByType(resType string) (GPUResourceSpec, bool) {
	for _, spec := range gpuResourceSpecs {
		if spec.Type == resType {
			return spec, true
		}
	}
	return GPUResourceSpec{}, false
}
