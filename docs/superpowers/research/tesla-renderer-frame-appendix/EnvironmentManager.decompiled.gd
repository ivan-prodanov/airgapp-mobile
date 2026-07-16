tool
extends WorldEnvironment

onready var theme_manager: ThemeManager = get_node('/root/Mobile/ThemeManager') as ThemeManager
onready var mobile_comm: MobileComm = get_node('/root/Mobile/MobileComm') as MobileComm
onready var tween: Tween = get_node('Tween')
onready var background_plane = get_node_or_null('/root/Mobile/MainViewContainer/Viewport/CameraManager/CameraPivot/Camera/Background')

export(Texture) var light_skybox_vehicle: Texture
export(Texture) var dark_skybox_vehicle: Texture
export(Texture) var cyber_skybox_vehicle: Texture
export(Texture) var light_skybox_energy: Texture
export(Texture) var dark_skybox_energy: Texture

var current_product_type = ProductManager.ProductType.VEHICLE
var last_selected_vehicle_type = 'modely'
var is_sky_box_rotating = False


var DEFAULT_ANIMATION_DURATION: float = 0.75
var DEFAULT_ANIMATION_TRANSITION: int = Tween.TRANS_QUART
var DEFAULT_ANIMATION_EASE: int = Tween.EASE_IN_OUT

var LOADING_STATE_ANIMATION_DURATION: float = 0.3

var light_background_color: Color = Color('#F7F7F7')
var dark_background_color: Color = Color('#161718')


var rotation: Vector3
var env_energy: float
var amb_energy: float
var animated: bool
var duration: float
var transition_type: int
var ease_type: int

func _ready():
	mobile_comm.register_listener(ReactMsg.SET_ENV_PARAMS, funcref(self, 'on_set_env_params'))
	mobile_comm.register_listener(ReactMsg.GODOT_CONFIG, funcref(self, 'on_godot_config'))
	
	if background_plane != None and OS.get_name() != 'iOS':
		background_plane.visible = True

	theme_manager.connect('set_app_theme', self, 'update_theme')
	update_theme(theme_manager.app_theme)

func on_set_env_params(data: Dictionary):
	rotation = Utils.vec3_from_data(data.get('rotation'), Vector3.ZERO)
	env_energy = data.get('env_energy', 3)
	amb_energy = data.get('amb_energy', 7)
	animated = data.get('animated', True)
	duration = data.get('duration', DEFAULT_ANIMATION_DURATION)
	transition_type = data.get('transition_type', DEFAULT_ANIMATION_TRANSITION)
	ease_type = data.get('ease_type', DEFAULT_ANIMATION_EASE)
	
	if animated:
		tween.interpolate_property(environment, 'background_sky_rotation_degrees', None, rotation, duration, transition_type, ease_type)
		tween.interpolate_property(environment, 'background_energy', None, env_energy, duration, transition_type, ease_type)
		tween.interpolate_property(environment, 'ambient_light_energy', None, amb_energy, duration, transition_type, ease_type)
		tween.start()
	else:
		tween.remove_all()
		environment.background_sky_rotation_degrees = rotation
		environment.background_energy = env_energy
		environment.ambient_light_energy = amb_energy
	
	is_sky_box_rotating = data.get('rotate_sky_box', False)

func on_godot_config(data: Dictionary):
	var light = data.get('light_theme_color')
	var dark = data.get('dark_theme_color')
	
	if light or dark:
		if light: light_background_color = Color(light)
		if dark: dark_background_color = Color(dark)
		update_theme(theme_manager.app_theme)

func set_background_energy(
	_energy: float,
	animated: bool = True,
	_ease_type: int = Tween.EASE_IN,
	_delay: float = 0,
	_duration: float = LOADING_STATE_ANIMATION_DURATION,
	_transition_type: int = Tween.TRANS_CUBIC
):
	if animated:
		tween.interpolate_property(environment, 'background_energy', environment.background_energy, _energy, _duration, _transition_type, _ease_type, _delay)
		tween.start()
	else:
		tween.remove_all()
		environment.background_energy = _energy

func update_theme(theme):
	if theme == theme_manager.ThemeType.LIGHT:
		environment.background_color = light_background_color
		if background_plane != None:
			background_plane.get_surface_material(0).albedo_color = light_background_color
	else:
		environment.background_color = dark_background_color
	
	VisualServer.set_default_clear_color(environment.background_color)
	
	update_environment_image()

func _notification(what):
	match what:
		MainLoop.NOTIFICATION_WM_FOCUS_IN:
			
			if OS.get_name() == 'iOS':
				update_environment_image(True)

func update_environment_image(force = False):
	var panorama: Texture
	var theme = theme_manager.app_theme
	var light_theme = theme_manager.ThemeType.LIGHT
	match current_product_type:
		ProductManager.ProductType.ENERGY:
			panorama = light_skybox_energy if theme == light_theme else dark_skybox_energy
		ProductManager.ProductType.VEHICLE:
			match last_selected_vehicle_type:
				'cybertruck':
					panorama = cyber_skybox_vehicle
				_:
					panorama = light_skybox_vehicle if theme == light_theme else dark_skybox_vehicle
	
	if panorama != environment.background_sky.panorama or force:
		environment.background_sky.panorama = panorama

func update_loading_effect(product_data: ProductData, animated_stop_loading = False):
	var vehicle_data = product_data as VehicleData
	if vehicle_data != None and vehicle_data.isLoading():
		set_background_energy(0)
	else:
		set_background_energy(env_energy, animated_stop_loading, Tween.EASE_OUT)

func _on_ProductSwitcher_on_show_product_node(product_node, product_data):
	current_product_type = ProductManager.ProductType.ENERGY if product_node is EnergySite else ProductManager.ProductType.VEHICLE
	if current_product_type == ProductManager.ProductType.VEHICLE:
		last_selected_vehicle_type =(product_data as VehicleData).vehicle_config.car_type
	update_environment_image()
	update_loading_effect(product_data)

func _on_VehicleManager_on_vehicle_update(vehicle, vehicle_data):
	update_loading_effect(vehicle_data, True)


func _process(delta):
	if is_sky_box_rotating:
		environment.background_sky_orientation = environment.background_sky_orientation.rotated(Vector3.UP, delta * PI / 72)

